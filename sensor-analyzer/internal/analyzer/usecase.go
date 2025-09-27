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

	unit := ""
	alertThreshold := 0.0
	shouldAlert := false

	switch sensorData.SensorType {
	case "temperature":
		unit = "°C"
		alertThreshold = 50
		shouldAlert = sensorData.Value > alertThreshold

	case "pressure":
		unit = "hPa"
		alertThreshold = 1050
		shouldAlert = sensorData.Value > alertThreshold

	case "vibration":
		unit = "m/s²"
		alertThreshold = 3.0
		shouldAlert = sensorData.Value > alertThreshold

	default:
		log.Printf("Tipo de sensor desconhecido: %s", sensorData.SensorType)
		return
	}

	log.Printf("Analisando sensor (%s) em %s: %.2f %s", sensorData.SensorType, sensorData.Place, sensorData.Value, unit)

	if shouldAlert {
		body, err := json.Marshal(sensorData)
		if err != nil {
			log.Printf("Erro ao converter JSON: %s", err)
			return
		}

		if err := a.Publisher.Publish("alerts", body); err != nil {
			log.Printf("Erro ao enviar alerta: %s", err)
		}
		fmt.Printf("Mensagem enviada: %s\n", string(body))
	}
}
