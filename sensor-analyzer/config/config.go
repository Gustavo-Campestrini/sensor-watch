package config

type Config struct {
	RabbitMQURL string
}

func Load() Config {
	return Config{
		// RabbitMQURL: "amqp://admin:admin@localhost:5672/",
		RabbitMQURL: "amqps://hgmyguwa:Sg7aBCRxSyhg-LAjaDVZBF98UBSEcNww@jaragua.lmq.cloudamqp.com/hgmyguwa",
	}
}
