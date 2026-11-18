# Roteiro Completo do Vídeo-Pitch Técnico — Projeto **GuardIão**

> **Formato:** Vídeo no YouTube (Modo Não Listado)  
> **Duração Máxima:** Até 5 minutos (Meta sugerida: **4min30s a 4min50s**)  
> **Pontuação Total:** 20 Pontos (conforme critérios oficiais de avaliação)

---

## Cronograma Sugerido de Gravação (4min45s)

| Bloco | Tempo | Pontos | Foco Principal |
| :--- | :---: | :---: | :--- |
| **1. Proposta e Problema Evidenciado** | `0:00 – 0:55` | 3 pts | Dor real das quedas em idosos, *long lie* e conexão com CitizenTech |
| **2. Público-Alvo e Mercado** | `0:55 – 1:40` | 3 pts | Quem usa, quem paga/implanta (Famílias, ILPIs, SUS/UBS) e contexto |
| **3. Impacto e Valor da Solução** | `1:40 – 2:35` | 3 pts | Demo prática ao vivo, privacidade (esqueleto), inclusão e ODS da ONU |
| **4. Diferencial** | `2:35 – 3:30` | 3 pts | Comparativo vs. relógios/CFTV + os 4 pilares técnicos na prática |
| **5. Resultados e Impacto Esperados** | `3:30 – 4:45` | 8 pts | **Bloco de maior peso:** KPIs, validação, expansão e sustentabilidade |

---

## Respostas Estruturadas por Tópico do Edital

### 1. Proposta do Projeto e Problema Evidenciado (3 pontos)
* **O que precisa ser respondido:** Qual é o problema real, quem é afetado, em qual contexto ocorre, por que precisa ser resolvido, evidências de relevância e relação com *CitizenTech*.

#### Resposta Base (Conteúdo Técnico)
* **O Problema:** Quedas domésticas são uma das principais causas de internação hospitalar, perda de autonomia e óbito acidental entre pessoas idosas no Brasil e no mundo (conforme alertas recorrentes da OMS e do Ministério da Saúde). O risco não está apenas no impacto da queda em si, mas no chamado **tempo prolongado no solo (*long lie*)**: quando o idoso mora sozinho ou passa o dia desacompanhado e fica horas caído sem conseguir pedir ajuda, o quadro evolui rapidamente para desidratação, hipotermia, lesão renal (rabdomiólise) e agravamento severo do prognóstico.
* **A Proposta (GuardIão):** Um sistema de monitoramento preventivo e detecção automática de emergências em tempo real que transforma qualquer câmera comum (webcam ou celular antigo) em um guardião silencioso dentro de casa, sem exigir que o idoso aperte botões, use relógios caros ou tenha sua privacidade filmada e exposta na internet.
* **Conexão com CitizenTech:** Em vez de impor um gadget caro que o idoso rejeita ou não sabe operar, o GuardIão coloca a tecnologia a serviço da realidade do cidadão comum — unindo acessibilidade financeira, dignidade (privacidade) e resposta rápida para salvar vidas.

#### Texto Sugerido para Fala (`0:00 – 0:55`)
> "Imagine um idoso que mora sozinho sofrer uma queda na sala de casa e ficar horas no chão porque não conseguiu alcançar o telefone. Segundo a Organização Mundial da Saúde e o Ministério da Saúde, as quedas estão entre as principais causas de hospitalização e perda de autonomia na terceira idade — e o fator que mais agrava esses casos não é só o tombo, mas a demora no socorro.  
> É para resolver esse problema real que nasce o **GuardIão**: uma solução CitizenTech que transforma câmeras comuns em sensores inteligentes de prevenção e socorro imediato, colocando a tecnologia a serviço da segurança e da dignidade do cidadão."

---

### 2. Público-Alvo e Mercado (3 pontos)
* **O que precisa ser respondido:** Quem são os cidadãos/segmentos beneficiados, contexto de utilização, potencial de adoção/mercado e principais envolvidos na implementação.

#### Resposta Base (Conteúdo Técnico)
* **Beneficiários Diretos (Usuários Finais):** Idosos (60+) que vivem sozinhos (*Aging in Place*) ou passam grande parte do dia sem cuidador presencial.
* **Beneficiários Indiretos / Operadores:**
  * **Segmento B2C (Famílias e Cuidadores):** Filhos e parentes que trabalham fora e precisam acompanhar a segurança dos pais à distância sem invadir sua intimidade.
  * **Segmento B2B (ILPIs e Clínicas):** Casas de repouso e centros de reabilitação que possuem poucos cuidadores por turno para monitorar dezenas de quartos e corredores.
  * **Segmento B2G (Saúde Pública / SUS):** Prefeituras, Unidades Básicas de Saúde (UBS) e equipes de Estratégia Saúde da Família (ESF) que acompanham idosos em situação de vulnerabilidade social.
* **Contexto de Uso e Potencial de Adoção:** Com o acelerado envelhecimento populacional brasileiro, a demanda por cuidados domiciliares cresce muito acima da oferta de cuidadores formais. Como o GuardIão roda em qualquer navegador com câmera simples e usa nuvem gratuita, a barreira de entrada para adoção residencial ou comunitária é mínima.

#### Texto Sugerido para Fala (`0:55 – 1:40`)
> "O GuardIão atende três frentes claras: primeiro, **famílias e idosos que moram sozinhos** e querem manter a independência em casa com tranquilidade; segundo, **casas de repouso e clínicas geriátricas**, onde equipes reduzidas precisam monitorar vários ambientes ao mesmo tempo; e terceiro, **prefeituras e Unidades Básicas de Saúde**, que podem acompanhar idosos vulneráveis no território sem precisar distribuir equipamentos caros.  
> Com o envelhecimento acelerado da população, soluções acessíveis de cuidado domiciliar têm altíssimo potencial de adoção em escala."

---

### 3. Impacto e Valor da Solução (3 pontos)
* **O que precisa ser respondido:** Como funciona na prática, como melhora a vida do público-alvo e quais os benefícios em acessibilidade, inclusão, segurança e ODS.

#### Resposta Base (Conteúdo Técnico)
* **Funcionamento Prático:**
  1. Uma webcam ou dispositivo posicionado no cômodo captura o ambiente localmente no navegador.
  2. A Visão Computacional extrai apenas um **esqueleto geométrico de 33 pontos**, descartando a imagem real da pessoa na própria memória do dispositivo.
  3. O sistema monitora postura e equilíbrio em tempo real. Ao detectar uma queda seguida de imobilidade (ex.: $\ge 5\text{ segundos}$), dispara automaticamente um alerta com laudo inteligente para o painel em nuvem do familiar ou cuidador em menos de 1 segundo.
  4. Paralelamente, registra episódios de "quase-queda" (desequilíbrios) e tempo ativo para gerar prevenção médica antes que o acidente aconteça.
* **Valor Gerado e Inclusão:**
  * **Zero fricção digital:** O idoso não precisa aprender a mexer em aplicativo, lembrar de carregar bateria de smartwatch nem apertar botão de pânico caso desmaie.
  * **Privacidade e Dignidade:** Nenhuma foto ou vídeo íntimo sai de casa.
* **Contribuição aos ODS da ONU:**
  * **ODS 3 (Saúde e Bem-Estar):** Reduz complicações pós-queda e permite atuação preventiva.
  * **ODS 10 (Redução das Desigualdades):** Leva monitoramento inteligente de ponta a populações de baixa renda sem hardware proprietário.
  * **ODS 11 (Cidades e Comunidades Sustentáveis):** Fortalece o envelhecimento seguro na comunidade e reduz internações evitáveis no sistema de saúde.

#### Texto Sugerido para Fala (`1:40 – 2:35`) — *[Exibir demonstração do protótipo na tela]*
> "Na prática, funciona assim: **[mostrar câmera + esqueleto no canvas]** o GuardIão lê a movimentação no próprio navegador e converte a pessoa em um esqueleto geométrico anônimo — **nenhuma imagem real vai para a nuvem**, preservando 100% da privacidade e atendendo à LGPD.  
> Se ocorre uma queda e o idoso permanece imóvel, **[mostrar simulação/detecção disparando alerta no Dashboard]** em segundos o painel da família ou da unidade de saúde recebe o alerta crítico com o diagnóstico da situação. E para o idoso, o esforço é zero: ele não precisa carregar relógio nem apertar botão. Isso conecta diretamente o projeto aos **ODS 3, 10 e 11 da ONU**."

---

### 4. Diferencial (3 pontos)
* **O que precisa ser respondido:** Diferenciais frente às alternativas existentes e como **cada uma das 4 tecnologias obrigatórias** resolve o problema de forma prática e viável.

#### Resposta Base (Conteúdo Técnico)
* **Comparativo com Alternativas Existentes:**
  * *Smartwatches e Botões de Pânico:* Exigem compra de hardware caro, recarga frequente e adesão contínua; além disso, botões manuais falham se o idoso perder a consciência ou sofrer confusão mental na queda.
  * *Câmeras de CFTV tradicionais:* Só gravam passivamente (alguém precisa estar olhando a tela para perceber o acidente) e expõem a intimidade dentro de casa.
  * *GuardIão:* Monitoramento passivo autônomo, sem equipamento vestível, com privacidade garantida na borda e inteligência preventiva.
* **Como os 4 Pilares Funcionam na Prática:**
  1. **Visão Computacional (MediaPipe Pose na Borda):** Extrai 33 landmarks anatômicos a 30 FPS direto no navegador, eliminando envio de vídeo pesado para servidores.
  2. **Inteligência Artificial (Dupla Camada):** Motor cinético/temporal analisa velocidade vertical de queda, ângulo do tronco ($< 30^\circ$) e tempo de imobilidade para filtrar falsos positivos (como sentar ou abaixar); na sequência, IA generativa (Gemini Flash) traduz os dados em um laudo claro de triagem para o cuidador.
  3. **Cloud Computing (Google Firebase / Cloud Firestore Plano Gratuito):** Como apenas JSONs leves de transição de estado e métricas são gravados (e nunca 30 frames por segundo), toda a arquitetura em nuvem roda no plano gratuito (Spark) com sincronização em tempo real via `onSnapshot`.
  4. **Análise de Dados (Dashboard Preventivo):** Transforma o histórico de desequilíbrios (*quase-quedas*), tempo ativo e velocidade postural em um **Score de Risco Preventivo**, permitindo agir antes da fratura.

#### Texto Sugerido para Fala (`2:35 – 3:30`)
> "Por que o GuardIão é diferente de um smartwatch ou de uma câmera comum? Porque o idoso não esquece de usar e ninguém precisa ficar olhando para uma tela.  
> E nossas 4 tecnologias trabalham juntas de forma viável: a **Visão Computacional** com MediaPipe extrai os 33 pontos do corpo direto no dispositivo; a **Inteligência Artificial** cruza velocidade de descida, ângulo do tronco e tempo imóvel para evitar falsos alarmes, gerando um laudo automático de triagem; a **Cloud no Firebase Firestore** recebe apenas eventos JSON leves e sincroniza o alerta em tempo real no plano gratuito; e a **Análise de Dados** consolida desequilíbrios e mobilidade para prever riscos antes da queda grave."

---

### 5. Resultados e Impacto Esperados (8 pontos — *Maior Peso da Nota*)
* **O que precisa ser respondido:** Resultados esperados, **indicadores (KPIs)** mensuráveis para avaliar benefícios, plano de validação e implementação, possibilidades de expansão e sustentabilidade.

#### Resposta Base (Conteúdo Técnico)
> **Nota de transparência acadêmica:** Apresente estes números claramente como **metas de resultado e KPIs de validação do projeto** (não como estatísticas de um estudo já encerrado em campo).

* **Indicadores de Desempenho e Impacto (KPIs do Projeto):**
  1. **KPI de Emergência (SLA de Detecção e Notificação):** Meta de latência ponta a ponta **inferior a 10 segundos** entre o fim da janela de imobilidade pós-queda e a chegada do alerta no painel do cuidador, reduzindo drasticamente o risco de permanência prolongada no solo (*long lie*).
  2. **KPI de Confiabilidade (Precisão / Taxa de Falsos Positivos):** Meta de taxa de falsos positivos **inferior a 5%** em atividades cotidianas (sentar, agachar, dormir), validada por registro de feedback (`SOCORRIDO` vs. `FALSO_POSITIVO`) no próprio Firestore.
  3. **KPI Preventivo (Antecipação de Risco):** Identificação precoce de queda de mobilidade ou aumento $\ge 30\%$ na frequência de desequilíbrios semanais antes de ocorrer uma queda crítica.
  4. **KPI de Viabilidade Econômica (Custo de Nuvem):** Operação dentro da cota gratuita do Firebase Spark (20 mil gravações/dia) utilizando arquitetura event-driven (estimativa de poucas dezenas de gravações diárias por residência monitorada).
* **Plano de Validação e Implementação (3 Fases):**
  * **Fase 1 — Validação Técnica em Bancada:** Testes controlados de cenários reais (caminhada, agachamento lento, desequilíbrio e queda simulada) calibrando os limiares biomecânicos e medindo taxa de acerto e consumo de cota no Firestore.
  * **Fase 2 — Piloto Assistido (Comunidade / ILPI Parceira):** Implantação controlada em 5 a 10 ambientes monitorados com acompanhamento de cuidadores para validar aceitação, usabilidade e tempo de resposta real.
  * **Fase 3 — Escala e Expansão:** Integração com bots de mensageria (WhatsApp/Telegram) para familiares, suporte multi-câmera por residência e painel regional para secretarias municipais de saúde (UBS/SUS).
* **Sustentabilidade do Projeto (Modelo de Negócio e Operação):**
  * **Custo de infraestrutura próximo de zero** graças ao processamento na borda (Edge) e arquitetura Serverless/Firestore.
  * **Sustentabilidade Financeira (Híbrida):** Acesso **gratuito (Freemium)** para famílias de baixa renda com 1 ambiente monitorado; planos acessíveis (B2C/B2B) para múltiplos cômodos, casas de repouso e clínicas; e licenciamento **B2G** para municípios integrarem ao programa de saúde do idoso, gerando economia direta ao sistema público ao evitar internações cirúrgicas e de UTI decorrentes de quedas graves.

#### Texto Sugerido para Fala (`3:30 – 4:45`)
> "Para garantir impacto real e mensurável, definimos quatro indicadores-chave de acompanhamento do GuardIão:  
> primeiro, **tempo de notificação abaixo de 10 segundos** após a confirmação da imobilidade, atacando diretamente o risco de permanência prolongada no solo;  
> segundo, **controle contínuo de falsos positivos** com meta abaixo de 5%, retroalimentado pelo botão de confirmação no próprio painel;  
> terceiro, **indicador preventivo de desequilíbrios**, alertando a família quando há perda progressiva de estabilidade;  
> e quarto, **eficiência de custo em nuvem**, pois como processamos o vídeo localmente e gravamos no Firestore apenas por eventos, mantemos o sistema dentro da cota gratuita para uso residencial inicial.  
> Nosso plano de implementação segue três fases: validação de precisão em laboratório com cenários simulados; piloto assistido em uma casa de repouso ou residência parceira; e expansão com alertas via WhatsApp e integração com Unidades Básicas de Saúde.  
> Na sustentabilidade, o modelo une impacto social e viabilidade: versão básica gratuita para famílias vulneráveis, assinatura acessível para clínicas e casas de repouso, e parcerias com prefeituras — onde cada fratura evitada gera economia direta para o sistema público de saúde.  
> No GuardIão, a tecnologia é o meio, a privacidade do cidadão é o centro, e salvar vidas com prevenção é o resultado."

---

## Checklist Final Antes de Enviar (Conforme `entregavel.txt`)
- [ ] Vídeo gravado com **duração máxima de 5 minutos** (ideal ~4min45s).
- [ ] Mostra na tela a solução funcionando na prática (câmera/esqueleto + gravação real no Cloud Firestore + Dashboard atualizando em tempo real).
- [ ] Cita explicitamente os **4 pilares técnicos** (Visão Computacional, IA, Cloud e Análise de Dados) e os **ODS da ONU**.
- [ ] Publicado no **YouTube em modo Não Listado**.
- [ ] Link salvo em um arquivo `.txt` ou `.zip` e enviado na plataforma **FIAP ON** dentro do prazo.
