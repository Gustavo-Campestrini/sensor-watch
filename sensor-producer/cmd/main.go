package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"time"

	"github.com/rabbitmq/amqp091-go"
)

type SensorData struct {
	SensorID    string  `json:"sensor_id"`
	Temperature float64 `json:"temperature"`
	Timestamp   string  `json:"timestamp"`
}

func main() {
	conn, err := amqp091.Dial("amqp://admin:admin@localhost:5672/")
	if err != nil {
		log.Fatalf("Erro ao conectar RabbitMQ: %s", err)
	}
	defer conn.Close()

	ch, err := conn.Channel()
	if err != nil {
		log.Fatalf("Erro ao abrir canal: %s", err)
	}
	defer ch.Close()

	queue, err := ch.QueueDeclare(
		"sensors.analyze", // nome da fila
		true,              // durable
		false,             // autoDelete
		false,             // exclusive
		false,             // noWait
		nil,               // args
	)
	if err != nil {
		log.Fatalf("Erro ao declarar fila: %s", err)
	}

	fmt.Println("Produtor pronto! Enviando mensagens...")

	for {
		data := SensorData{
			SensorID:    "sensor_1",
			Temperature: 45 + rand.Float64()*10, //Temperatura
			Timestamp:   time.Now().Format(time.RFC3339),
		}

		body, err := json.Marshal(data)
		if err != nil {
			log.Printf("Erro ao converter JSON: %s", err)
			continue
		}

		err = ch.Publish(
			"",         // exchange
			queue.Name, // routing key (nome da fila)
			false,      // mandatory
			false,      // immediate
			amqp091.Publishing{
				ContentType: "application/json",
				Body:        body,
			},
		)
		if err != nil {
			log.Printf("Erro ao publicar mensagem: %s", err)
		} else {
			fmt.Printf("Mensagem enviada: %s\n", string(body))
		}

		time.Sleep(2 * time.Second)
	}
}
