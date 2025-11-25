package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"sensor-analyzer/config"
	"sensor-analyzer/internal/analyzer"
	"sensor-analyzer/internal/election"
	"sensor-analyzer/internal/provider/rabbitmq"
	"strconv"
	"strings"
	"time"

	"github.com/rabbitmq/amqp091-go"

	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func startMetricsServer(port string, nodeID int) {
	go func() {
		addr := ":" + port
		log.Printf("[Nó %d] Servidor de Métricas rodando em http://localhost:%s/metrics", nodeID, port)
		if err := http.ListenAndServe(addr, nil); err != nil {
			log.Fatalf("[Nó %d] Erro ao iniciar servidor de métricas: %s", nodeID, err)
		}
	}()
}

func NewMongoClient(uri string) (*mongo.Client, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		return nil, err
	}
	return client, nil
}

func StartMongoWatcher(ctx context.Context, collection *mongo.Collection, handler func(event map[string]interface{})) error {
	stream, err := collection.Watch(ctx, mongo.Pipeline{})
	if err != nil {
		return err
	}

	go func() {
		defer stream.Close(ctx)

		for stream.Next(ctx) {
			var event map[string]interface{}
			if err := stream.Decode(&event); err != nil {
				log.Println("Erro ao decodificar evento:", err)
				continue
			}

			handler(event)
		}

		if err := stream.Err(); err != nil {
			log.Println("Erro no ChangeStream:", err)
		}
	}()

	return nil
}

func main() {
	cfg := config.Load()

	args := os.Args[1:]
	if len(args) != 4 {
		log.Fatalf("Uso: go run ./cmd <id> <my_addr> <all_ring_addrs_comma_separated> <metrics_port>")
	}

	id, err := strconv.Atoi(args[0])
	if err != nil {
		log.Fatalf("ID inválido: %s", args[0])
	}
	myAddr := args[1]
	ringAddrs := strings.Split(args[2], ",")

	metricsPort := args[3]

	if len(ringAddrs) < 2 {
		log.Fatalf("O anel deve ter pelo menos 2 nós.")
	}

	startMetricsServer(metricsPort, id)

	log.Printf("=== INICIANDO SENSOR-ANALYZER [NÓ %d] ===", id)
	log.Printf("Meu Endereço: %s | Anel Completo: %v", myAddr, ringAddrs)

	conn, err := amqp091.Dial(cfg.RabbitMQURL)
	if err != nil {
		log.Fatalf("[Nó %d] Erro ao conectar RabbitMQ: %s", id, err)
	}
	defer conn.Close()

	ch, err := conn.Channel()
	if err != nil {
		log.Fatalf("[Nó %d] Erro ao abrir canal: %s", id, err)
	}
	defer ch.Close()

	err = ch.ExchangeDeclare("alerts", "fanout", true, false, false, false, nil)
	if err != nil {
		log.Fatalf("Erro ao declarar exchange 'alerts': %s", err)
	}

	_, err = ch.QueueDeclare(
		"sensors.analyze",
		true,
		false,
		false,
		false,
		nil,
	)
	if err != nil {
		log.Fatalf("Erro ao declarar fila 'sensors.analyze': %s", err)
	}

	publisher := rabbitmq.NewPublisher(ch)
	useCase := analyzer.NewAnalyzer(publisher)

	node := election.NewNode(id, myAddr, ringAddrs)
	node.StartServices()

	var currentConsumer *rabbitmq.Consumer
	var mongoWatchCancel context.CancelFunc

	log.Printf("[Nó %d] Aguardando estado de liderança...", id)

	for {
		select {
		case <-node.BecomeLeaderCh:
			log.Printf("[Nó %d] *** TORNEI-ME LÍDER ***. Iniciando consumer.", id)

			if currentConsumer != nil {
				log.Printf("[Nó %d] Aviso: Trocando liderança sem parada prévia?", id)
				currentConsumer.Stop()
			}

			currentConsumer = rabbitmq.NewConsumer(ch)

			onMessageCallback := func(msg []byte) {
				useCase.Analyze(msg)
			}

			if err := currentConsumer.Start("sensors.analyze", onMessageCallback); err != nil {
				log.Printf("[Nó %d] ERRO FATAL ao iniciar consumer: %s", id, err)
				node.StartElection()
			}

			log.Printf("[Nó %d] Iniciando MongoDB Watcher...", id)

			ctx, cancel := context.WithCancel(context.Background())
			mongoWatchCancel = cancel

			mongoCli, err := NewMongoClient("mongodb+srv://workerjs:rWjHdj53F7lzADbq@cluster0.zhwrc7g.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0")
			if err != nil {
				log.Fatalf("Erro ao conectar Mongo: %v", err)
			}

			thresholdColl := mongoCli.Database("test").Collection("thresholds")

			cursor, err := thresholdColl.Find(ctx, map[string]interface{}{})
			if err == nil {
				for cursor.Next(ctx) {
					var doc struct {
						Sensor     string  `bson:"sensor"`
						UpperLimit float64 `bson:"upperLimit"`
						LowerLimit float64 `bson:"lowerLimit"`
						Unit       string  `bson:"unit"`
					}
					cursor.Decode(&doc)

					analyzer.SetThreshold(doc.Sensor, doc.UpperLimit, doc.LowerLimit, doc.Unit)

					log.Printf("[Nó %d] Threshold carregado: %s [%.2f - %.2f]",
						id, doc.Sensor, doc.LowerLimit, doc.UpperLimit)
				}
			}

			err = StartMongoWatcher(ctx, thresholdColl, func(event map[string]interface{}) {
				full, ok := event["fullDocument"].(map[string]interface{})
				if !ok {
					return
				}

				sensor, _ := full["sensor"].(string)
				upper, _ := full["upperLimit"].(float64)
				lower, _ := full["lowerLimit"].(float64)
				unit, _ := full["unit"].(string)

				analyzer.SetThreshold(sensor, upper, lower, unit)
				log.Printf("[Nó %d] Threshold atualizado via watcher: %s [%.2f - %.2f]",
					id, sensor, lower, upper)
			})

			if err != nil {
				log.Printf("[Nó %d] Erro ao iniciar watcher Mongo: %v", id, err)
			}

		case <-node.StopLeaderCh:
			log.Printf("[Nó %d] *** PERDI A LIDERANÇA ***. Parando consumer.", id)

			if currentConsumer != nil {
				if err := currentConsumer.Stop(); err != nil {
					log.Printf("[Nó %d] Erro ao parar consumer: %s", err)
				}
				currentConsumer = nil
			}

			if mongoWatchCancel != nil {
				log.Printf("[Nó %d] Parando Mongo Watcher...", id)
				mongoWatchCancel()
				mongoWatchCancel = nil
			}
		}
	}
}
