package rabbitmq

type Publisher interface {
	Publish(topic string, data []byte) error
}
