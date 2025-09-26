package rabbitmq

import (
	"github.com/rabbitmq/amqp091-go"
)

type publisher struct {
	channel *amqp091.Channel
}

func NewPublisher(ch *amqp091.Channel) Publisher {
	return &publisher{channel: ch}
}

func (p *publisher) Publish(topic string, data []byte) error {
	return p.channel.Publish(
		topic,
		"",
		false,
		false,
		amqp091.Publishing{
			ContentType: "application/json",
			Body:        data,
		},
	)
}
