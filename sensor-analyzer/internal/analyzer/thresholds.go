package analyzer

import "sync"

type Threshold struct {
	Sensor     string  `json:"sensor"`
	UpperLimit float64 `json:"upperLimit"`
	LowerLimit float64 `json:"lowerLimit"`
	Unit       string  `json:"unit"`
}

var (
	Thresholds = make(map[string]Threshold)
	thMutex    sync.RWMutex
)

func SetThreshold(sensor string, upper float64, lower float64, unit string) {
	thMutex.Lock()
	Thresholds[sensor] = Threshold{Sensor: sensor, UpperLimit: upper, LowerLimit: lower, Unit: unit}
	thMutex.Unlock()
}

func GetThreshold(sensor string) (Threshold, bool) {
	thMutex.RLock()
	v, ok := Thresholds[sensor]
	thMutex.RUnlock()
	return v, ok
}
