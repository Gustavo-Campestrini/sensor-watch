package domain

type AlertPublisher interface {
	Publish(alert Alert) error
}
