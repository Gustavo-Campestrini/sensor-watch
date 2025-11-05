package election

// go run ./cmd/main.go 1 localhost:8081 "localhost:8081,localhost:8082,localhost:8083"
// go run ./cmd/main.go 2 localhost:8082 "localhost:8081,localhost:8082,localhost:8083"
// go run ./cmd/main.go 3 localhost:8083 "localhost:8081,localhost:8082,localhost:8083"
import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"sync"
	"time"
)

type ElectionMessage struct {
	CandidateID   int    `json:"candidate_id"`
	CandidateAddr string `json:"candidate_addr"`
}
type CoordinatorMessage struct {
	LeaderID   int    `json:"leader_id"`
	LeaderAddr string `json:"leader_addr"`
}

type Node struct {
	ID   int
	Addr string

	ringAddrs []string
	myIndex   int

	IsLeader   bool
	LeaderID   int
	LeaderAddr string

	BecomeLeaderCh chan bool
	StopLeaderCh   chan bool

	mu sync.RWMutex

	inElection bool
	muElection sync.Mutex
}

func NewNode(id int, addr string, allAddrs []string) *Node {
	myIdx := -1
	for i, a := range allAddrs {
		if a == addr {
			myIdx = i
			break
		}
	}
	if myIdx == -1 {
		log.Fatalf("Endereço '%s' não encontrado na lista do anel: %v", addr, allAddrs)
	}

	return &Node{
		ID:             id,
		Addr:           addr,
		ringAddrs:      allAddrs,
		myIndex:        myIdx,
		BecomeLeaderCh: make(chan bool),
		StopLeaderCh:   make(chan bool),
	}
}

func (n *Node) StartServices() {
	go n.startHTTPServer()
	go n.monitorLeader()
	time.Sleep(1 * time.Second)

	go n.StartElection()
}

func (n *Node) startHTTPServer() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/election", n.handleElection)
	mux.HandleFunc("/coordinator", n.handleCoordinator)

	log.Printf("[Node %d] Servidor de eleição ouvindo em %s", n.ID, n.Addr)
	if err := http.ListenAndServe(n.Addr, mux); err != nil {
		log.Fatalf("[Node %d] Erro no servidor HTTP: %s", n.ID, err)
	}
}

func (n *Node) handleElection(w http.ResponseWriter, r *http.Request) {
	var msg ElectionMessage
	if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	log.Printf("[Node %d] Recebeu msg de eleição: Candidato %d", n.ID, msg.CandidateID)

	if msg.CandidateID == n.ID {
		log.Printf("[Node %d] === EU SOU O NOVO LÍDER ===", n.ID)
		n.setLeader(n.ID, n.Addr)
		n.announceLeadership()
		return
	}

	if msg.CandidateID > n.ID {
		n.forwardMessage("/election", msg)
	} else {
		n.muElection.Lock()
		if !n.inElection {
			n.inElection = true
			n.muElection.Unlock()
			log.Printf("[Node %d] Candidato %d é mais fraco. Iniciando minha própria eleição.", n.ID, msg.CandidateID)
			n.forwardMessage("/election", ElectionMessage{
				CandidateID:   n.ID,
				CandidateAddr: n.Addr,
			})
		} else {
			n.muElection.Unlock()
			log.Printf("[Node %d] Ignorando candidato fraco %d (já em eleição)", n.ID, msg.CandidateID)
		}
	}
}

func (n *Node) handleCoordinator(w http.ResponseWriter, r *http.Request) {
	var msg CoordinatorMessage
	if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	if msg.LeaderID == n.ID {
		log.Printf("[Node %d] Anúncio de liderança completou o anel.", n.ID)
		return
	}

	log.Printf("[Node %d] Novo líder é %d (%s)", n.ID, msg.LeaderID, msg.LeaderAddr)
	n.setLeader(msg.LeaderID, msg.LeaderAddr)

	n.forwardMessage("/coordinator", msg)
}

func (n *Node) StartElection() {
	n.muElection.Lock()
	if n.inElection {
		n.muElection.Unlock()
		log.Printf("[Node %d] Tentou iniciar eleição, mas uma já está em progresso.", n.ID)
		return
	}
	n.inElection = true
	n.muElection.Unlock()

	log.Printf("[Node %d] INICIANDO ELEIÇÃO...", n.ID)
	n.setLeader(0, "")

	n.forwardMessage("/election", ElectionMessage{
		CandidateID:   n.ID,
		CandidateAddr: n.Addr,
	})
}

func (n *Node) announceLeadership() {
	n.forwardMessage("/coordinator", CoordinatorMessage{
		LeaderID:   n.ID,
		LeaderAddr: n.Addr,
	})
	n.muElection.Lock()
	n.inElection = false
	n.muElection.Unlock()
}

func (n *Node) monitorLeader() {
	for {
		time.Sleep(3 * time.Second)

		n.mu.RLock()
		isLeader := n.IsLeader
		leaderAddr := n.LeaderAddr
		n.mu.RUnlock()

		if isLeader || leaderAddr == "" {
			continue
		}

		resp, err := http.Get("http://" + leaderAddr + "/health")
		if err != nil || resp.StatusCode != http.StatusOK {
			log.Printf("[Node %d] LÍDER %s PARECE MORTO! (%v)", n.ID, leaderAddr, err)
			n.StartElection()
		} else {
			resp.Body.Close()
		}
	}
}

func (n *Node) setLeader(id int, addr string) {
	n.mu.Lock()
	defer n.mu.Unlock()

	wasLeader := n.IsLeader
	n.LeaderID = id
	n.LeaderAddr = addr
	n.IsLeader = (n.ID == id)

	if !wasLeader && n.IsLeader {
		n.BecomeLeaderCh <- true
	} else if wasLeader && !n.IsLeader {
		n.StopLeaderCh <- true
	}

	if !n.IsLeader && id != 0 {
		n.muElection.Lock()
		n.inElection = false
		n.muElection.Unlock()
	}
}

func (n *Node) forwardMessage(path string, payload interface{}) error {
	jsonBody, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[Node %d] Erro ao serializar msg: %s", n.ID, err)
		return err
	}

	numNodes := len(n.ringAddrs)

	for i := 1; i < numNodes; i++ {
		targetIndex := (n.myIndex + i) % numNodes
		targetAddr := n.ringAddrs[targetIndex]
		url := "http://" + targetAddr + path

		resp, err := http.Post(url, "application/json", bytes.NewBuffer(jsonBody))

		if err == nil {
			defer resp.Body.Close()
			io.Copy(io.Discard, resp.Body)
			return nil
		}

		log.Printf("[Node %d] Falha ao enviar para %s (%s). Tentando próximo...", n.ID, targetAddr, err)
	}

	log.Printf("[Node %d] ERRO CRÍTICO: Anel quebrado. Não foi possível contatar nenhum outro nó.", n.ID)
	return errors.New("anel quebrado")
}
