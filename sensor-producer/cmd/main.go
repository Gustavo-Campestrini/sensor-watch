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
	Value      float64 `json:"value"`
	SensorType string  `json:"type"`
	Timestamp  string  `json:"timestamp"`
	Place      string  `json:"place"`
}

func main() {
	conn, err := amqp091.Dial("amqps://hgmyguwa:Sg7aBCRxSyhg-LAjaDVZBF98UBSEcNww@jaragua.lmq.cloudamqp.com/hgmyguwa")
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
			SensorType: "temperature",
			Value:      45 + rand.Float64()*10, //Temperatura
			Timestamp:  time.Now().Format(time.RFC3339),
			Place:      "jaragua",
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
