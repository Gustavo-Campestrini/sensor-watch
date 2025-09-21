package analyzer

type AnalyzerUsecase interface {
	Analyze(msg []byte)
}
