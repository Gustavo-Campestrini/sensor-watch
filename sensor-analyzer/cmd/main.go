package main

import (
	"log"
	"sensor-analyzer/config"
	"sensor-analyzer/internal/analyzer"
	"sensor-analyzer/internal/provider/rabbitmq"

	"github.com/rabbitmq/amqp091-go"
)

func main() {
	cfg := config.Load()

	conn, err := amqp091.Dial(cfg.RabbitMQURL)
	if err != nil {
		log.Fatalf("Erro ao conectar RabbitMQ: %s", err)
	}
	defer conn.Close()

	ch, err := conn.Channel()
	if err != nil {
		log.Fatalf("Erro ao abrir canal: %s", err)
	}
	defer ch.Close()

	err = ch.ExchangeDeclare(
		"alerts",
		"fanout",
		true,
		false,
		false,
		false,
		nil,
	)
	if err != nil {
		log.Fatalf("Erro ao declarar exchange: %s", err)
	}

	publisher := rabbitmq.NewPublisher(ch)
	a := analyzer.NewAnalyzer(publisher)

	consumer := rabbitmq.NewConsumer(ch)
	msgs, err := consumer.Consume("sensors.analyze")
	if err != nil {
		log.Fatalf("Erro ao consumir fila: %s", err)
	}

	log.Println("Aguardando mensagens...")

	for msg := range msgs {
		a.Analyze(msg)
	}
}
