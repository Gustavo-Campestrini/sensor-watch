package rabbitmq

type Publisher interface {
	Publish(topic string, data []byte) error
}

type Consumer interface {
	Consume(topic string) (<-chan []byte, error)
}
