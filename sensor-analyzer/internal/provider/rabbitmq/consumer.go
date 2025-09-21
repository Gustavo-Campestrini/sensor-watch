package rabbitmq

import (
	"github.com/rabbitmq/amqp091-go"
)

type consumer struct {
	channel *amqp091.Channel
}

func NewConsumer(ch *amqp091.Channel) Consumer {
	return &consumer{channel: ch}
}

func (c *consumer) Consume(topic string) (<-chan []byte, error) {
	q, err := c.channel.QueueDeclare(topic, true, false, false, false, nil)
	if err != nil {
		return nil, err
	}

	msgs, err := c.channel.Consume(q.Name, "", true, false, false, false, nil)
	if err != nil {
		return nil, err
	}

	ch := make(chan []byte)
	go func() {
		for m := range msgs {
			ch <- m.Body
		}
		close(ch)
	}()
	return ch, nil
}
