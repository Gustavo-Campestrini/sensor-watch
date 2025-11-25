package analyzer

import (
	"encoding/json"
	"fmt"
	"log"
	"sensor-analyzer/internal/provider/rabbitmq"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var sensorValueGauge = promauto.NewGaugeVec(
	prometheus.GaugeOpts{
		Name: "sensor_analyzer_value",
		Help: "Valor atual do sensor analisado.",
	},
	[]string{"sensor_type"},
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

	rules, found := GetThreshold(sensorData.SensorType)
	if !found {
		log.Printf("Tipo de sensor desconhecido: %s", sensorData.SensorType)
		return
	}

	shouldAlert := sensorData.Value > rules.UpperLimit || sensorData.Value < rules.LowerLimit

	sensorValueGauge.WithLabelValues(sensorData.SensorType).Set(sensorData.Value)

	log.Printf(
		"Sensor %s (%s): %.2f %s (range: %.2f - %.2f)",
		sensorData.SensorType,
		sensorData.Place,
		sensorData.Value,
		rules.Unit,
		rules.LowerLimit,
		rules.UpperLimit,
	)

	if shouldAlert {
		body, err := json.Marshal(sensorData)
		if err != nil {
			log.Printf("Erro ao serializar alerta: %s", err)
			return
		}

		if err := a.Publisher.Publish("alerts", body); err != nil {
			log.Printf("Erro ao enviar alerta: %s", err)
		}

		fmt.Printf("ALERTA enviado: %s\n", string(body))
	}
}
