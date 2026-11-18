# Pendências da Implementação — GuardIão (retomar daqui)

> Atualizado em 18/11/2026. Plano original: `C:\Users\Oliv\.gemini\antigravity\brain\e7ad93cb-d167-4c90-aba1-35a20e6205fa\implementation_plan.md`
> Regras obrigatórias: `ARQUITETURA_TECNICA.md` e `REGRAS_E_BOAS_PRATICAS.md`.

## 1. O que já está PRONTO ✅

| Camada | Arquivos | Status |
| :--- | :--- | :--- |
| Config | `src/config/thresholds.js`, `env.js`, `env.example.js` | ✅ (o `env.js` agora só exige `apiKey` + `projectId`) |
| Domain | `entities/PoseFrame.js`, `MobilityAlert.js`, `DailyMetrics.js`, `services/BiomechanicsCalculator.js`, `PostureStateMachine.js`, `repositories/AlertRepository.js`, `TriageAIService.js` | ✅ |
| Application | `ProcessPoseFrameUseCase.js`, `RegisterEmergencyAlertUseCase.js`, `UpdateMobilityMetricsUseCase.js` | ✅ |
| Infrastructure | `vision/MediaPipePoseAdapter.js` (com tempos do simulador já ajustados), `ai/GeminiTriageAdapter.js`, `ai/RuleBasedTriageFallback.js`, `persistence/FirestoreRepository.js`, `LocalStorageRepository.js`, `RepositoryFactory.js`, **`SwitchableRepository.js` (novo)** | ✅ |
| Servidor & Scripts | `server.js` (porta 3000), `package.json` (`test` e `test:e2e`) | ✅ |
| Presentation | `index.html`, `styles.css`, `src/main.js`, `views/SkeletonCanvasRenderer.js`, `views/ChartsRenderer.js` (Chart.js via CDN + fallback em Canvas nativo), `controllers/MonitorController.js`, `controllers/DashboardController.js` | ✅ |
| Testes | `tests/biomechanics.test.js` + `tests/infrastructure.test.js` (**60/60 passando**), `tests/e2e/*` (Playwright, tiers 1–4 — **112/112 passando**) | ✅ |
| Documentação | `ARQUITETURA_TECNICA.md`, `REGRAS_E_BOAS_PRATICAS.md`, `PENDENCIAS_IMPLEMENTACAO.md`, `walkthrough.md` | ✅ |

Tempos do simulador validados a 16/33/50 ms: o desequilíbrio entra em ~132 ms e se recupera em ~1,1 s; a queda entra em `QUEDA_DETECTADA` em ~132 ms e vira `ALERTA_CRITICO` em ~5,25 s.

---

## 2. O que foi CONCLUÍDO ✅ e pendência manual

### 2.1 `index.html` (na raiz) — ✅ Concluído
Precisa de todos os `data-testid` usados por `tests/e2e/helpers/locators.mjs`. Pontos de atenção:
- `<link rel="icon" href="data:,">`. Sem isso o navegador pede `/favicon.ico`, recebe 404 e os testes E2E falham.
- `<main data-testid="app-shell">` com duas `<section>`:
  - `data-testid="panel-monitor"` com `aria-label="Estação Edge — Monitoramento"`
  - `data-testid="panel-dashboard"` com `aria-label="Dashboard Preventivo"`
- **Painel Monitor:** um contêiner `monitorStage` contendo `<video data-testid="monitor-video" muted playsinline>` e, por cima, `<canvas data-testid="monitor-canvas" width="640" height="400" role="img" aria-label="Esqueleto Biomecânico">`. Também precisa de:
  - checkbox `privacy-mode-toggle` (**checked** por padrão)
  - botões `btn-start-camera` e `btn-stop-camera`
  - `camera-status-msg` (`role="status"`)
  - badge `posture-state-badge` (`data-state="EM_PE"`)
  - HUD: `hud-trunk-angle`, `hud-vertical-velocity`, `hud-immobility-timer`
  - botões `btn-sim-normal` ("Postura Normal"), `btn-sim-imbalance` ("Desequilíbrio") e `btn-sim-fall` ("Queda Crítica")
  - slider `sensitivity-slider` (`type="range" min="10" max="50" step="1" value="35"`), `sensitivity-value` e um elemento de dica (`sensitivityHint`)
- **Painel Dashboard:**
  - `connection-mode-badge` (`role="status"`) e o botão `btn-open-config` ("Configurar Cloud / IA")
  - `emergency-banner` (`role="alert"`, com `hidden`), **sempre no DOM e ANTES do modal**, com um span interno para o texto
  - 4 cards de KPI: `kpi-sla-status`, `kpi-risk-score`, `kpi-weekly-imbalances` e `kpi-cloud-ops`. Cada um tem um elemento de valor e um de dica.
  - `<ul data-testid="alert-feed-list" aria-label="Feed de Alertas">` e um parágrafo "nenhum alerta" (`alertFeedEmpty`)
  - `<canvas data-testid="chart-weekly-mobility" width="520" height="240" aria-label="Evolução Semanal..." style="width:100%;height:auto">` e `<canvas data-testid="chart-hourly-vulnerability" ...>` com o mesmo `style`. O **`style` inline é obrigatório**: sem ele o Chart.js define largura em px e quebra o layout mobile.
- **Modal:** `<div data-testid="config-modal" role="dialog" hidden>` com:
  - `<textarea data-testid="input-firebase-config" aria-label="Firebase Config">`
  - `<input data-testid="input-gemini-api-key" name="geminiApiKey" aria-label="Gemini API Key">`
  - `config-validation-error` (`role="alert"`, `hidden`)
  - botões `btn-save-config` ("Salvar"), `btn-clear-config` ("Usar Modo Local") e `btn-close-config` ("Fechar")
- `<script type="module" src="./src/main.js"></script>`

### 2.2 `styles.css` — ✅ Concluído
- Tema escuro: `body { background:#0b1120; color:#f1f5f9 }`
- `[hidden]{display:none !important}` e `.is-hidden{display:none !important}` (esconde o vídeo no modo LGPD)
- Grid com 2 colunas a partir de 960 px e 1 coluna abaixo disso, **sem overflow horizontal em 390 px** (`max-width:100%`, `overflow-wrap:anywhere`, `canvas{max-width:100%}`)
- O `monitorStage` usa `position:relative`, com vídeo e canvas sobrepostos
- Cores para cada `[data-state]` do badge e estilos para `.alert-card`, `.chip`, `.btn`, banner e modal

### 2.3 `src/main.js` (montagem / injeção de dependências) — ✅ Concluído
1. Pegar os elementos do DOM pelo `data-testid` e montar os objetos `elements` exatamente com as chaves usadas nos controllers:
   - **Monitor:** `privacyToggle, btnStartCamera, btnStopCamera, btnSimNormal, btnSimImbalance, btnSimFall, sensitivitySlider, sensitivityValue, sensitivityHint, video, monitorStage, cameraStatusMsg, postureBadge, hudTrunkAngle, hudVerticalVelocity, hudImmobilityTimer`
   - **Dashboard:** `connectionBadge, emergencyBanner, emergencyBannerText, kpiSlaStatus, kpiSlaStatusValue, kpiSlaStatusHint, kpiRiskScore, kpiRiskScoreValue, kpiRiskScoreHint, kpiWeeklyImbalances, kpiWeeklyImbalancesValue, kpiCloudOps, kpiCloudOpsValue, alertFeedList, alertFeedEmpty, btnOpenConfig, btnCloseConfig, btnSaveConfig, btnClearConfig, configModal, inputFirebaseConfig, inputGeminiApiKey, configValidationError`
2. `const env = loadEnvConfig()`, depois `const repo = new SwitchableRepository(new LocalStorageRepository({ patientId: env.patientId }))`. A montagem começa **sempre síncrona com LocalStorage**.
3. Criar os casos de uso:
   - `new ProcessPoseFrameUseCase()`
   - `new RegisterEmergencyAlertUseCase({ alertRepository: repo, triageAIService: new GeminiTriageAdapter(), patientId })`
   - `new UpdateMobilityMetricsUseCase({ alertRepository: repo, patientId })`
4. Hidratar o caso de uso de métricas **uma vez**, com a métrica de hoje que chega na primeira emissão de `repo.subscribeToDailyMetrics` (`metricsUseCase.hydrate(todayMetric)`).
5. Criar os demais objetos:
   - `new SkeletonCanvasRenderer(canvas)`
   - `new ChartsRenderer({ weeklyCanvas, hourlyCanvas })`, chamando `charts.loadChartLibrary()` sem `await`
   - `new MediaPipePoseAdapter()`
6. Criar o `DashboardController` com estas opções:
   - `getLiveTodayMetrics: () => metricsUseCase.getCurrentMetrics()`
   - `envService: { loadEnvConfig, saveEnvConfig, clearEnvConfig }`
   - `onConfigChanged: applyBackend`

   Depois disso, criar o `MonitorController` com `onFrame: () => dashboard.refreshLiveKpis()`.
7. Função `applyBackend(config)`:
   - Se `isValidFirebaseConfig(config.firebaseConfig)`:
     1. Rodar `dashboard.setConnectionMode('CONNECTING')`, de forma **síncrona**.
     2. Fazer `await RepositoryFactory.create({ firebaseConfig })`.
     3. Se o resultado for um `FirestoreRepository`: `repo.switchTo(r)` e `setConnectionMode('FIRESTORE')`.
     4. Caso contrário: `setConnectionMode('FIRESTORE_FAILED')`.
   - Senão: `repo.switchTo(new LocalStorageRepository(...))` e `setConnectionMode('LOCAL')`.
8. Chamar `dashboard.init()`, `monitor.init()` e `applyBackend(env)`. No `pagehide`/`beforeunload`, chamar `metricsUseCase.flush({ force:true })`.

### 2.4 Ajustar `package.json` — ✅ Concluído
`"test": "node --test tests/biomechanics.test.js tests/infrastructure.test.js"` e `"test:e2e": "node tests/e2e/run-e2e.mjs --all"`

### 2.5 Verificar — ✅ Concluído
```powershell
npm test                                   # 60/60 passando
npm start                                  # abrir http://localhost:3000 e testar manualmente
npm run test:e2e                           # 112/112 passando (tiers 1–4)
```
Para corrigir falhas E2E, use os testes como contrato (`tests/e2e/tier*.e2e.mjs`). Pontos sensíveis:
- O botão de socorro nunca é removido do card; ele só fica `disabled` (o teste de duplo clique depende disso).
- O badge exibe "Cloud Firestore" logo após Salvar.
- O seed de 7 dias fica no LocalStorage.
- Com o slider no mínimo (10°), a detecção fica desativada.

### 2.6 Finalizar
- ✅ Criar `walkthrough.md` com o resumo, os resultados dos testes e o guia passo a passo de Firebase / Gemini API (`C:\Users\Oliv\.gemini\antigravity\brain\b6b99ca9-ddce-460b-9411-46d1940f4cad\walkthrough.md`).
- ✅ Atualizar `ARQUITETURA_TECNICA.md` para citar: o `SwitchableRepository`, o Chart.js com fallback em Canvas nativo, o estado inicial ocioso em `"Simulador: Postura Normal"`, `θ < 35°` (10°–50°), `fonte_ia`, `gemini-2.0-flash` e `src/config/*`.
- ⏳ **Pendência manual do autor:** Gravar o vídeo-pitch seguindo `ROTEIRO_VIDEO_PITCH.md`.

---

## 3. Histórico de retomada (concluído em 18/11/2026)
> Referência anterior: "Leia `PENDENCIAS_IMPLEMENTACAO.md` e conclua os itens da seção 2 (index.html, styles.css, src/main.js, package.json), depois rode `npm test` e os testes E2E e corrija o que falhar." — **Concluído.**
