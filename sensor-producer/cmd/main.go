package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"strings"
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
	var sensorType string
	var place string

	fmt.Println("Escolha o tipo de sensor para simulação:")
	fmt.Println("1 - Temperatura")
	fmt.Println("2 - Pressão")
	fmt.Println("3 - Vibração")
	fmt.Print("Digite o número da opção: ")

	var opcao int
	_, err := fmt.Scanln(&opcao)
	if err != nil {
		log.Fatalf("Erro ao ler a entrada: %s", err)
	}

	switch opcao {
	case 1:
		sensorType = "temperature"
	case 2:
		sensorType = "pressure"
	case 3:
		sensorType = "vibration"
	default:
		log.Fatalf("Opção inválida: %d", opcao)
	}

	fmt.Print("Digite o local do sensor (ex: salaX, salaY): ")
	_, err = fmt.Scanln(&place)
	if err != nil {
		log.Fatalf("Erro ao ler o local: %s", err)
	}
	place = strings.TrimSpace(place)

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

	fmt.Printf("Sensor de '%s' em '%s' pronto! Enviando mensagens...\n", sensorType, place)

	for {
		data := SensorData{
			SensorType: sensorType,
			Value:      gerarValorAleatorio(sensorType),
			Timestamp:  time.Now().Format(time.RFC3339),
			Place:      place,
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

func gerarValorAleatorio(sensor string) float64 {
	switch sensor {
	case "temperature":
		return 45 + rand.Float64()*10
	case "pressure":
		return 900 + rand.Float64()*200
	case "vibration":
		return rand.Float64() * 5
	default:
		return 0
	}
}
