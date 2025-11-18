package main

import (
	"log"
	"net/http"
	"os"
	"sensor-analyzer/config"
	"sensor-analyzer/internal/analyzer"
	"sensor-analyzer/internal/election"
	"sensor-analyzer/internal/provider/rabbitmq"
	"strconv"
	"strings"

	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/rabbitmq/amqp091-go"
)

func startMetricsServer(port string, nodeID int) {
	http.Handle("/metrics", promhttp.Handler())
	go func() {
		addr := ":" + port
		log.Printf("[Nó %d] Servidor de Métricas rodando em http://localhost:%s/metrics", nodeID, port)
		if err := http.ListenAndServe(addr, nil); err != nil {
			log.Fatalf("[Nó %d] Erro ao iniciar servidor de métricas: %s", nodeID, err)
		}
	}()
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

	log.Printf("[Nó %d] Aguardando estado de liderança...", id)
	for {
		select {
		case <-node.BecomeLeaderCh:
			log.Printf("[Nó %d] *** TORNEI-ME LÍDER ***. Iniciando consumer.", id)
			if currentConsumer != nil {
				log.Println("[Nó %d] Aviso: Trocando liderança sem parada prévia?", id)
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

		case <-node.StopLeaderCh:
			log.Printf("[Nó %d] *** PERDI A LIDERANÇA ***. Parando consumer.", id)
			if currentConsumer != nil {
				if err := currentConsumer.Stop(); err != nil {
					log.Printf("[Nó %d] Erro ao parar consumer: %s", err)
				}
				currentConsumer = nil
			} else {
				log.Printf("[Nó %d] Aviso: Recebi ordem de parada sem ter consumer ativo.", id)
			}
		}
	}
}
