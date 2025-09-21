package config

type Config struct {
	RabbitMQURL string
}

func Load() Config {
	return Config{
		RabbitMQURL: "amqp://admin:admin@localhost:5672/",
	}
}
