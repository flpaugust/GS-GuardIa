# Regras de Engenharia, Clean Architecture e Boas Práticas — Projeto **GuardIão**

Este documento define a arquitetura de código, os padrões obrigatórios e os **anti-patterns proibidos** para o desenvolvimento do protótipo **GuardIão**. Todo código gerado ou revisado deve seguir estritamente estas regras.

---

## 1. Estrutura de Clean Architecture (Separação de Camadas)

O projeto adota uma estrutura modular baseada em **Clean Architecture** e **SOLID**, garantindo que a lógica biomecânica e de análise de risco seja totalmente independente de frameworks de visão computacional, banco de dados ou interface visual.

```text
src/
├── main.js                        # Composition root (injeção de dependências e bootstrap da UI)
├── config/
│   ├── thresholds.js              # Constantes nomeadas e configurações (sem magic numbers)
│   ├── env.js                     # Gerenciamento seguro de credenciais em localStorage (guardiao_env_config)
│   └── env.example.js             # Modelo documentado de variáveis/credenciais locais
├── domain/                        # NÚCLEO PURO (Zero dependências externas)
│   ├── entities/
│   │   ├── PoseFrame.js           # Estrutura normalizada dos 33 landmarks
│   │   ├── MobilityAlert.js       # Entidade de alerta (validação de tipos, fonte_ia e severidade)
│   │   └── DailyMetrics.js        # Entidade de métricas diárias e Score de Risco
│   ├── services/
│   │   ├── BiomechanicsCalculator.js  # Cálculo de centro de massa, ângulos e velocidade
│   │   └── PostureStateMachine.js     # Máquina de estados: EM_PE, DESEQUILIBRIO, QUEDA_DETECTADA, ALERTA_CRITICO
│   └── repositories/
│       ├── AlertRepository.js     # Interface/Contrato abstrato de persistência de alertas
│       └── TriageAIService.js     # Interface/Contrato abstrato para geração de laudo
├── application/                   # CASOS DE USO (Orquestração do fluxo)
│   ├── ProcessPoseFrameUseCase.js     # Recebe landmarks, atualiza máquina de estados e emite eventos
│   ├── RegisterEmergencyAlertUseCase.js # Gera laudo (IA ou fallback) e persiste com debounce
│   └── UpdateMobilityMetricsUseCase.js  # Consolida métricas periódicas e calcula Score Preventivo
├── infrastructure/                # ADAPTADORES EXTERNOS (Troca fácil de tecnologia)
│   ├── vision/
│   │   └── MediaPipePoseAdapter.js    # Integração com @mediapipe/tasks-vision + simulador biomecânico
│   ├── persistence/
│   │   ├── FirestoreRepository.js     # Implementação real com Cloud Firestore
│   │   ├── LocalStorageRepository.js  # Fallback automático offline/sem credenciais + BroadcastChannel
│   │   ├── RepositoryFactory.js       # Seleção segura entre FirestoreRepository e LocalStorageRepository
│   │   └── SwitchableRepository.js    # Proxy que permite trocar de backend em runtime re-assinando listeners
│   └── ai/
│       ├── GeminiTriageAdapter.js     # Integração assíncrona com Google Gemini API (gemini-2.0-flash)
│       └── RuleBasedTriageFallback.js # Gerador de laudo determinístico local + sanitização LGPD
└── presentation/                  # UI / DASHBOARD / CÂMERA
    ├── controllers/
    │   ├── MonitorController.js       # Coordena loop de câmera e chamadas aos Use Cases
    │   └── DashboardController.js     # Assina onSnapshot/eventos, modal de config e atualiza KPIs
    └── views/
        ├── SkeletonCanvasRenderer.js  # Desenho do esqueleto anônimo e HUD no <canvas>
        └── ChartsRenderer.js          # Gráficos preventivos com Chart.js + fallback em Canvas 2D nativo
```

### Regras de Dependência entre Camadas
1. **`domain/` não importa ninguém:** Proibido importar `firebase`, `@mediapipe`, `fetch`, `window`, `document` ou bibliotecas de UI dentro de `domain/`. Todas as funções de geometria e máquina de estados devem ser **puras e testáveis** sem webcam ou internet.
2. **`application/` só enxerga `domain/`:** Os casos de uso recebem repositórios e adaptadores por **Injeção de Dependência** (construtor/parâmetro), nunca instanciando `FirestoreRepository` diretamente dentro da regra de negócio.
3. **`infrastructure/` implementa os contratos do `domain/`:** Adaptadores externos traduzem formatos de APIs (MediaPipe, Firestore, Gemini) para entidades do domínio.
4. **`presentation/` apenas exibe estado e captura interação:** Nenhum cálculo de ângulo ou query direta de banco deve residir em manipuladores de botão ou renderizadores de `<canvas>`.

---

## 2. O que NÃO Fazer ao Gerar Código (Anti-Patterns Proibidos)

### ❌ 1. Proibido gravar no Firestore dentro do loop de vídeo (30 FPS)
* **Por quê:** Um loop a 30 FPS gera 1.800 gravações por minuto e esgotaria a cota gratuita diária do Cloud Firestore (20.000 escritas/dia) em ~11 minutos de uso.
* **Regra:** Apenas **transições confirmadas de estado** (ex.: entrada em `DESEQUILIBRIO` ou `ALERTA_CRITICO`) e **consolidações periódicas** (ex.: `UpdateMobilityMetricsUseCase` a cada 60 segundos ou ao encerrar o monitoramento) podem gravar no banco, sempre protegidas por *debounce/throttle*.

### ❌ 2. Proibido enviar imagens, frames ou vídeos brutos para a nuvem
* **Por quê:** Viola o princípio central de *Privacy-by-Design* (LGPD), aumenta drasticamente o consumo de banda/armazenamento e inviabiliza a cota gratuita.
* **Regra:** O `<video>` e os pixels brutos ficam estritamente na memória local do navegador. Apenas JSONs leves com dados de evento e métricas numéricas trafegam na rede.

### ❌ 3. Proibido bloquear a UI Thread no loop `requestAnimationFrame`
* **Por quê:** Fazer `await` síncrono em chamadas de rede (Firestore ou Gemini API) dentro do ciclo de renderização congela a câmera, trava a detecção de novos frames e compromete a precisão da velocidade vertical.
* **Regra:** Chamadas externas (persistência de alerta e triagem por IA) devem ser disparadas de forma **assíncrona e desacoplada** (fire-and-forget controlado com tratamento de erro e fila/estado de envio).

### ❌ 4. Proibido criar "God Files" ou Código Espaguete
* **Por quê:** Misturar detecção MediaPipe, matemática de vetores, `document.getElementById` e `addDoc(collection(...))` no mesmo arquivo torna o código impossível de manter, testar ou explicar na banca.
* **Regra:** Arquivos devem ser pequenos e coesos. Funções devem ter responsabilidade única, preferencialmente abaixo de 30–40 linhas, com retorno antecipado (*early return*) e sem aninhamento profundo.

### ❌ 5. Proibido usar "Magic Numbers" espalhados pelo código
* **Por quê:** Números soltos como `if (angle < 28 && dt > 5000)` dificultam calibração durante testes e demonstrações ao vivo.
* **Regra:** Todo limiar biomecânico, intervalo de debounce, tempo de imobilidade e peso de risco deve ser declarado como constante documentada em `src/config/thresholds.js`.

### ❌ 6. Proibido depender 100% da rede sem Fallback (Zero Ponto Único de Falha)
* **Por quê:** Se uma chave de API expirar, o limite gratuito da API de IA oscilar ou o dispositivo ficar momentaneamente offline durante o Vídeo-Pitch, o sistema não pode travar ou exibir tela em branco.
* **Regra:** Toda integração externa deve implementar **Graceful Degradation**:
  * Falha no Firestore / ausência de config $\rightarrow$ `LocalStorageRepository` transparente.
  * Falha na Gemini API $\rightarrow$ `RuleBasedTriageFallback` gera o laudo imediatamente.

### ❌ 7. Proibido expor segredos no repositório ou Hardcode de chaves sensíveis
* **Por quê:** Vazamento de credenciais em código público ou entrega acadêmica é falha grave de segurança.
* **Regra:** Configurações do Firebase Web SDK e chaves opcionais de IA devem ficar isoladas em arquivo de configuração de ambiente local (com arquivo `.example` versionado) e nunca expor chaves administrativas/privadas no front-end.

---

## 3. Boas Práticas Obrigatórias de Desenvolvimento

### 3.1 Geometria Pura e Estabilidade Numérica
* Validar sempre a visibilidade (`visibility >= MIN_LANDMARK_VISIBILITY`) dos landmarks críticos (ombros e quadris) antes de calcular ângulos ou disparar quedas, evitando falsos positivos quando a pessoa sai parcialmente da câmera.
* Utilizar suavização temporal (ex.: média móvel simples sobre os últimos $N$ frames para posição do centro de massa) para reduzir ruído de detecção da webcam.
* Proteger divisões por $\Delta t$ contra divisão por zero ou saltos causados por queda de FPS (`dt = Math.max(rawDt, MIN_DELTA_TIME_MS)`).

### 3.2 Princípios de Clean Code e Nomenclatura
* **Código em inglês ou português consistente:** Padronizar identificadores técnicos em inglês (`calculateTrunkAngle`, `PostureStateMachine`) ou seguir o padrão definido nas entidades do domínio (`EM_PE`, `QUEDA_CRITICA`) sem misturar idiomas de forma aleatória na mesma camada.
* **Sem lógica duplicada:** Extrair utilitários compartilhados (ex.: cálculo de ponto médio entre landmark esquerdo e direito, formatação de timestamp) em vez de repetir fórmulas.
* **Tratamento explícito de erros:** Nunca silenciar exceções com `catch (e) {}` vazio; registrar contexto útil e acionar o fallback correspondente.

### 3.3 Preparação para Testes e Demonstração ao Vivo
* **Testes unitários no domínio:** A camada `domain/` deve possuir cenários de teste determinísticos simulando sequências de coordenadas para:
  1. Pessoa caminhando normalmente (`EM_PE`).
  2. Pessoa inclinando rapidamente e voltando (`DESEQUILIBRIO`).
  3. Pessoa caindo e ficando imóvel $\ge 5\text{ s}$ (`QUEDA_DETECTADA` $\rightarrow$ `ALERTA_CRITICO`).
  4. Pessoa abaixando devagar e levantando (`EM_PE` — sem falso positivo).
* **Modo Simulação / Calibração na UI:** Incluir controles discretos na interface de demonstração (ex.: "Modo Privacidade: Só Esqueleto", ajuste de sensibilidade e botão de simulação de queda/desequilíbrio) para validar o fluxo ponta a ponta no Firestore e Dashboard mesmo em ambientes com espaço físico limitado.
