package analyzer

import (
	"encoding/json"
	"log"
	"sensor-analyzer/internal/provider/rabbitmq"
)

type analyzerUsecase struct {
	Publisher rabbitmq.Publisher
}

func NewAnalyzer(pub rabbitmq.Publisher) AnalyzerUsecase {
	return &analyzerUsecase{Publisher: pub}
}

func (a *analyzerUsecase) Analyze(msg []byte) {
	var sensorData struct {
		Temperature float64 `json:"temperature"`
	}
	if err := json.Unmarshal(msg, &sensorData); err != nil {
		log.Printf("Erro ao decodificar sensor: %s", err)
		return
	}

	log.Printf("Analisando sensor: %.2f°C", sensorData.Temperature)
	if sensorData.Temperature > 50 {
		alert := []byte("🔥 ALERTA! Temperatura > 50°C")
		if err := a.Publisher.Publish("alerts", alert); err != nil {
			log.Printf("Erro ao enviar alerta: %s", err)
		}
	}
}
