package rabbitmq

import (
	"log"

	"github.com/google/uuid"
	"github.com/rabbitmq/amqp091-go"
)

// Consumer encapsula a lógica de consumo do RabbitMQ
type Consumer struct {
	ch   *amqp091.Channel
	tag  string     // Tag única para este consumer
	done chan error // Canal para sinalizar parada
}

func NewConsumer(ch *amqp091.Channel) *Consumer {
	return &Consumer{
		ch:   ch,
		done: make(chan error),
		// Geramos uma tag única para poder cancelar este consumer específico
		tag: "consumer-" + uuid.New().String(),
	}
}

// Start consome a fila e entrega mensagens para um canal de callback.
// Esta função NÃO bloqueia.
func (c *Consumer) Start(queueName string, onMessage func(msg []byte)) error {
	log.Printf("[Consumer %s] Iniciando consumo da fila %s", c.tag, queueName)

	msgs, err := c.ch.Consume(
		queueName,
		c.tag, // consumerTag
		false, // autoAck
		false, // exclusive
		false, // noLocal
		false, // noWait
		nil,   // args
	)
	if err != nil {
		return err
	}

	// Goroutine para processar mensagens
	go func() {
		for {
			select {
			case <-c.done: // Sinal de parada
				log.Printf("[Consumer %s] Parando consumo", c.tag)
				return
			case d, ok := <-msgs:
				if !ok {
					log.Printf("[Consumer %s] Canal de mensagens fechado", c.tag)
					c.done <- nil // Sinaliza que parou
					return
				}
				// Executa o callback (a análise)
				onMessage(d.Body)
				// Confirma a mensagem
				d.Ack(false)
			}
		}
	}()

	return nil
}

// Stop pára o consumer elegantemente
func (c *Consumer) Stop() error {
	log.Printf("[Consumer %s] Enviando sinal de parada...", c.tag)
	if err := c.ch.Cancel(c.tag, false); err != nil {
		log.Printf("[Consumer %s] Erro ao cancelar: %s", c.tag, err)
		return err
	}

	// Envia um sinal no canal done (caso o Cancel não feche o 'msgs' imediatamente)
	// Usamos um select para não bloquear se já estiver fechado
	select {
	case c.done <- nil:
	default:
	}

	return nil
}
