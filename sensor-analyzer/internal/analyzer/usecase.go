package analyzer

import (
	"encoding/json"
	"fmt"
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
		Value      float64 `json:"value"`
		SensorType string  `json:"type"`
		Timestamp  string  `json:"timestamp"`
		Place      string  `json:"place"`
	}
	if err := json.Unmarshal(msg, &sensorData); err != nil {
		log.Printf("Erro ao decodificar sensor: %s", err)
		return
	}

	log.Printf("Analisando sensor: %.2f°C", sensorData.Value)

	body, err := json.Marshal(sensorData)
	if err != nil {
		log.Printf("Erro ao converter JSON: %s", err)
		return
	}

	if sensorData.Value > 50 {
		if err := a.Publisher.Publish("alerts", body); err != nil {
			log.Printf("Erro ao enviar alerta: %s", err)
		}
		fmt.Printf("Mensagem enviada: %s\n", string(body))
	}
}
