# Especificação Técnica e Arquitetura — Projeto **GuardIão**

> **Tema:** Global Solution 2 — *CitizenTech: Tecnologia a Serviço do Cidadão*  
> **Solução:** Sistema de Monitoramento Preventivo, Detecção de Quedas e Emergências para Idosos com *Privacy-by-Design* e Infraestrutura 100% Gratuita.

---

## 1. Visão Geral da Solução

O **GuardIão** é uma plataforma CitizenTech acessível que transforma qualquer câmera comum (webcam de computador, câmera de celular antigo ou câmera IP doméstica) em um sensor inteligente de segurança e saúde preventiva para idosos que moram sozinhos, passam o dia desacompanhados ou residem em Instituições de Longa Permanência (ILPIs).

Diferente de câmeras convencionais (que apenas gravam e invadem a privacidade) ou dispositivos vestíveis (que o idoso frequentemente esquece de carregar ou não consegue acionar ao desmaiar), o GuardIão processa o vídeo **localmente no dispositivo do usuário (Edge Computing)**, descarta a imagem bruta imediatamente e envia para a nuvem apenas eventos críticos e métricas anônimas de mobilidade.

---

## 2. Diagrama de Arquitetura Ponta a Ponta

```text
[Câmera / Webcam Local (30 FPS)]
       │
       ▼  (Frames processados apenas em memória RAM — nunca armazenados ou enviados)
┌────────────────────────────────────────────────────────────────────────────┐
│ 1. VISÃO COMPUTACIONAL (Edge / Browser — Client-Side)                      │
│ • Engine: Google MediaPipe Pose (@mediapipe/tasks-vision) via WebAssembly  │
│ • Saída: 33 pontos anatômicos (landmarks x, y, z, visibility)              │
│ • Privacy-by-Design (LGPD): Descarte imediato do frame de vídeo bruto      │
└────────────────────────────────────────────────────────────────────────────┘
       │
       ▼  (Coordenadas geométricas em tempo real)
┌────────────────────────────────────────────────────────────────────────────┐
│ 2. INTELIGÊNCIA ARTIFICIAL (Dupla Camada)                                  │
│ • Camada 1 — Motor Cinético/Temporal (Local / Tempo Real):                 │
│   - Calcula velocidade vertical do centro de massa (ombros/quadril)        │
│   - Calcula ângulo de inclinação do tronco (θ < 35° padrão; ajustável      │
│     entre 10° e 50°, sendo 10° o modo de calibração/desativado)            │
│   - Controla janela de imobilidade pós-queda (t ≥ 5s) e desequilíbrios     │
│ • Camada 2 — IA Generativa de Triagem (Google Gemini API — Free Tier):     │
│   - Modelo `gemini-2.0-flash`: gera laudo técnico contextualizado,          │
│     classifica criticidade e sugere ação imediata (com fallback            │
│     determinístico local `RuleBasedTriageFallback` em caso offline)        │
└────────────────────────────────────────────────────────────────────────────┘
       │
       ▼  (Apenas JSONs leves na troca de estado / janela agregada)
┌────────────────────────────────────────────────────────────────────────────┐
│ 3. CLOUD COMPUTING (100% Gratuita — Google Firebase Spark Plan)            │
│ • `SwitchableRepository`: Proxy que inicia em `LocalStorageRepository` e   │
│   alterna em tempo de execução para `FirestoreRepository` (re-assinando    │
│   listeners ao vivo sem recarregar a página)                               │
│ • Cloud Firestore (NoSQL Real-Time Database):                              │
│   - Coleção `alertas`: eventos de queda, desequilíbrio e imobilidade       │
│   - Coleção `metricas_mobilidade`: telemetria diária agregada              │
│ • Firebase Hosting: Hospedagem estática gratuita com HTTPS nativo          │
│ • Controle de Cota: Escrita orientada a eventos (debounce/throttle)        │
└────────────────────────────────────────────────────────────────────────────┘
       │
       ▼  (Sincronização push via listener `onSnapshot` < 1s)
┌────────────────────────────────────────────────────────────────────────────┐
│ 4. ANÁLISE DE DADOS (Dashboard Preventivo em Tempo Real)                   │
│ • Painel Web (Família / Cuidadores / Agentes de Saúde — UBS/SUS)           │
│ • Visualização: `ChartsRenderer` (Chart.js via CDN com fallback nativo em  │
│   Canvas 2D para operação 100% offline)                                    │
│ • Indicadores: Score de Risco Preventivo (0–100), evolução da mobilidade,  │
│   horários críticos de desequilíbrio e SLA de tempo de resposta            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detalhamento dos 4 Pilares Obrigatórios

### 3.1 Pilar 1 — Visão Computacional (`Edge Computing` no Navegador)
* **Tecnologia principal:** `@mediapipe/tasks-vision` (Google MediaPipe Pose Landmarker) executado no navegador via WebAssembly/WebGL.
* **Funcionamento:**
  * Captura o fluxo de vídeo via `navigator.mediaDevices.getUserMedia` a até 30 FPS.
  * Extrai **33 marcos anatômicos (landmarks)** tridimensionais normalizados `(x, y, z, visibility)` — incluindo nariz, ombros (`11, 12`), quadris (`23, 24`), joelhos (`25, 26`) e tornozelos (`27, 28`).
  * Renderiza apenas o **esqueleto geométrico** sobre o `<canvas>` (com opção de ocultar totalmente o vídeo de fundo no modo privacidade).
* **Privacy-by-Design (Conformidade LGPD):**
  * Nenhum frame de imagem, foto ou vídeo é gravado em disco ou transmitido pela rede. Toda a inferência visual ocorre na CPU/GPU local, resolvendo a principal barreira cultural de aceitação de câmeras dentro de residências.

### 3.2 Pilar 2 — Inteligência Artificial (Dupla Camada)
Para eliminar falsos positivos comuns (ex.: sentar no sofá, abaixar-se para pegar um objeto ou deitar normalmente), a IA opera em duas camadas complementares:

1. **Camada 1 — Motor Biomecânico e Máquina de Estados Temporal (Local):**
   * **Centro de Massa (CoM):** Média ponderada das coordenadas dos ombros e quadris.
   * **Velocidade Vertical ($v_y$):** Variação rápida da coordenada $y$ do centro de massa entre frames consecutivos ($\Delta y / \Delta t$).
   * **Ângulo do Tronco ($\theta$):** Ângulo formado entre o vetor quadril $\rightarrow$ ombro e o eixo horizontal do solo. Postura ereta $\approx 75^\circ\text{–}90^\circ$; postura horizontalizada crítica por padrão quando $\theta < 35^\circ$ (`TRUNK_FALL_ANGLE_DEG: 35.0`), ajustável pelo controle de sensibilidade entre $10^\circ$ e $50^\circ$ (na posição mínima de $10^\circ$, a detecção de queda fica em modo de calibração/desativada).
   * **Estados da Máquina:**
     * `EM_PE` / `NORMAL`: Tronco verticalizado e variação suave de altura.
     * `DESEQUILIBRIO` (*Quase-queda*): Oscilação brusca de ângulo ou velocidade vertical anômala seguida de recuperação postural em menos de $3\text{ s}$.
     * `QUEDA_DETECTADA`: Queda rápida de altura ($v_y$ acima do limiar) + inclinação horizontal ($\theta < 35^\circ$ no padrão, ou abaixo do limiar configurado no slider). Inicia contagem de imobilidade.
     * `ALERTA_CRITICO`: Permanência no solo sem recuperação postural ou movimento significativo por $t \ge 5\text{ segundos}$ (configurável).

2. **Camada 2 — IA Generativa de Triagem (Google Gemini API — Free Tier):**
   * Quando um estado crítico ou padrão anômalo é confirmado, o adaptador assíncrono `GeminiTriageAdapter` envia apenas metadados sanitizados (tipo de evento, ângulo, velocidade vertical, tempo imóvel, horário e histórico recente de desequilíbrios — sem vídeo, imagem ou landmarks) para o modelo **`gemini-2.0-flash`** via header `x-goog-api-key` (camada gratuita).
   * A IA retorna um **laudo de triagem legível para familiares e equipes de saúde**, classificando a severidade e indicando os primeiros passos de verificação (`fonte_ia: "GEMINI"`).
   * **Resiliência (Fallback):** Caso a chave da API não esteja configurada, ocorra timeout (6 s) ou falte conexão momentânea, o `RuleBasedTriageFallback` gera automaticamente o laudo estruturado local (`fonte_ia: "FALLBACK_LOCAL"`) sem interromper o alerta.

### 3.3 Pilar 3 — Cloud Computing (100% Gratuita — Firebase Spark Plan)
Toda a arquitetura em nuvem foi desenhada para operar dentro dos limites gratuitos do **Google Firebase (Plano Spark — sem necessidade de cartão de crédito)**:

* **Cloud Firestore (Banco NoSQL em Tempo Real):**
  * **Cota gratuita:** 50.000 leituras/dia, 20.000 gravações/dia, 20.000 exclusões/dia e 1 GiB de armazenamento.
  * **Estratégia de Economia de Cota:** O loop de 30 FPS **nunca** escreve diretamente no banco. As gravações ocorrem apenas em **transições de estado relevantes** (ex.: ocorrência de queda ou desequilíbrio, protegidas por debounce de 15 s) e em **janelas agregadas periódicas** (ex.: consolidação de métricas de mobilidade a cada 60 segundos ou encerramento de sessão via `pagehide`).
  * **Troca Dinâmica de Backend (`SwitchableRepository`):** A aplicação inicializa de forma síncrona sobre `LocalStorageRepository` (com seed histórico de 7 dias e sincronização entre abas via `BroadcastChannel`) e utiliza o proxy `SwitchableRepository` + `RepositoryFactory` para alternar em tempo de execução para `FirestoreRepository` (ou retornar ao modo local) sem reiniciar a página, re-assinando automaticamente todos os listeners ativos.
  * **Sincronização em Tempo Real:** O Dashboard utiliza o listener `onSnapshot` do SDK Web do Firestore (consultas filtradas por `idoso_id` com ordenação em memória, dispensando índices compostos), disparando alertas visuais e sonoros na tela de familiares/cuidadores em menos de 1 segundo após a gravação do evento.
* **Firebase Hosting:** Publicação gratuita da aplicação estática com certificado **HTTPS nativo** (obrigatório pelos navegadores para liberar acesso à webcam em dispositivos móveis e desktops remotos).

#### Schema das Coleções no Cloud Firestore

**Coleção `alertas`** (documentos gerados por evento de emergência ou risco):
```json
{
  "idoso_id": "paciente_01",
  "tipo": "QUEDA_CRITICA",
  "timestamp": "ServerTimestamp",
  "angulo_tronco_graus": 18.4,
  "velocidade_vertical": 1.85,
  "tempo_imovel_seg": 7,
  "laudo_ia": "Alerta Crítico: Queda brusca detectada com inclinação de 18.4° e imobilidade há 7s. Recomenda-se contato telefônico imediato e verificação presencial.",
  "fonte_ia": "GEMINI",
  "severidade": "CRITICA",
  "status_atendimento": "PENDENTE",
  "atendido_em": null
}
```
*Valores permitidos para `tipo`: `"QUEDA_CRITICA"`, `"DESEQUILIBRIO"`, `"IMOBILIDADE_PROLONGADA"`.*  
*Valores permitidos para `fonte_ia`: `"GEMINI"`, `"FALLBACK_LOCAL"`.*  
*Valores permitidos para `status_atendimento`: `"PENDENTE"`, `"EM_VERIFICACAO"`, `"SOCORRIDO"`, `"FALSO_POSITIVO"`.*

**Coleção `metricas_mobilidade`** (telemetria diária consolidada para análise longitudinal):
```json
{
  "idoso_id": "paciente_01",
  "data": "2026-11-17",
  "tempo_ativo_min": 145,
  "tempo_sentado_min": 380,
  "qtd_desequilibrios": 3,
  "qtd_quedas": 0,
  "velocidade_marcha_media": 0.92,
  "score_risco_preventivo": 72,
  "atualizado_em": "ServerTimestamp"
}
```

### 3.4 Pilar 4 — Análise de Dados (Saúde Preventiva)
Mais do que reagir após o acidente, o Dashboard (`ChartsRenderer`) carrega **Chart.js** de forma assíncrona via CDN (`chart.js@4.4.1`) e possui um **renderizador nativo em Canvas 2D como fallback offline**, garantindo que os gráficos nunca fiquem em branco sem internet e transformando séries históricas em inteligência preventiva:

* **Score de Risco Preventivo (0 a 100):** Índice calculado a partir da variação de tempo ativo vs. sedentarismo, frequência de desequilíbrios (*quase-quedas*) e queda gradual da agilidade postural ao longo dos dias.
* **Mapa Horário de Vulnerabilidade:** Gráfico que identifica em quais horários do dia ocorrem mais desequilíbrios (ex.: madrugada ao levantar para ir ao banheiro, ou período pós-medicação).
* **Indicadores de Atendimento (SLA):** Monitora o tempo médio decorrido entre a detecção (`timestamp`) e o atendimento (`atendido_em`), além da taxa de confirmação vs. falsos positivos para recalibragem contínua dos limiares.

---

## 4. Alinhamento aos Objetivos de Desenvolvimento Sustentável (ODS — ONU)

| ODS | Nome | Contribuição Concreta do GuardIão |
| :---: | :--- | :--- |
| **ODS 3** | **Saúde e Bem-Estar** | Reduz a gravidade de acidentes domésticos por quedas ao minimizar o tempo sem socorro (*long lie*) e fornece dados preditivos para atuação preventiva de médicos, familiares e equipes de atenção básica. |
| **ODS 10** | **Redução das Desigualdades** | Democratiza o telemonitoramento residencial ao eliminar a dependência de *smartwatches*, pulseiras proprietárias e mensalidades caras, funcionando em câmeras simples com processamento local e nuvem gratuita. |
| **ODS 11** | **Cidades e Comunidades Sustentáveis** | Promove o envelhecimento seguro e autônomo no próprio lar (*Aging in Place*) e reduz internações evitáveis de longa duração, aliviando a sobrecarga da rede pública de urgência e emergência. |

---

## 5. Requisitos Não Funcionais e Estratégia de Demonstração

* **Disponibilidade e Modo Offline (Graceful Degradation):** Caso o ambiente de execução esteja sem credenciais Firebase configuradas ou sem acesso à internet, o `SwitchableRepository` mantém/alterna transparentemente para `LocalStorageRepository` (com `BroadcastChannel`), o `GeminiTriageAdapter` degrada para `RuleBasedTriageFallback`, e o `ChartsRenderer` utiliza o fallback nativo em Canvas 2D, garantindo que o protótipo e o Dashboard continuem 100% demonstráveis.
* **Estado Inicial Ocioso Seguro (`Simulador: Postura Normal`):** Ao inicializar a interface (`MonitorController`), a câmera permanece desligada por padrão e o simulador biomecânico entra automaticamente no cenário `"Simulador: Postura Normal"` (estado `EM_PE`), animando o esqueleto no `<canvas>` sem gerar alertas nem gravações espúrias até interação do usuário ou detecção real pela webcam.
* **Calibração para Espaços Reduzidos e Credenciais Locais:** Parâmetros biomecânicos e de cota são centralizados em `src/config/thresholds.js`, enquanto credenciais opcionais do usuário (Firebase e Gemini API) são gerenciadas em `src/config/env.js` (referência em `src/config/env.example.js`), persistidas exclusivamente na chave `guardiao_env_config` do `localStorage` via modal `"Configurar Cloud / IA"` — nunca no código-fonte.
