# Propuesta: orquestación mediante mapa de proyecto y capacidades multi-worktree

## Problema y brecha del estado actual

Cuando los desarrolladores usan `gentle-pi` en proyectos con múltiples dimensiones, el harness carece de un mapa arquitectónico integral a nivel de proyecto. Actualmente:

1. **No existe un mapa del proyecto en Gentle Shell:** Gentle Shell presenta las tarjetas Status, Captured Changes y TODO, pero no ofrece una vista global de las capacidades del proyecto, sus dependencias ni el grado de cobertura de cada área.
2. **Deriva horizontal y superficies invisibles:** en proyectos amplios —como mostró el caso de Junglex— la planificación y la ejecución tienden a concentrarse en la primera superficie abordada, por ejemplo backend/API. Frontend, UX, operaciones, migraciones de datos, seguridad y pruebas pueden quedar fuera de vista hasta que aparecen problemas de integración.
3. **Transporte transitorio entre orquestadores:** la comunicación existente (`orchestrator_session_id`, `orchestrator_list` y `orchestrator_send_message`) funciona únicamente como transporte efímero de notificación y ACK dentro del perfil local. No proporciona cola offline, reintentos, difusión, claims durables de capacidades, consultas de dependencias, propuesta y aceptación de contratos ni garantías verificables de finalización.
4. **Subagentes aislados frente a worktrees reales:** aunque `subagent_run.workspace_root` puede ejecutar un subagente en un worktree determinado y `/gentle:changes` puede mostrar worktrees con cambios, no existe un sistema cohesivo para abrir terminales Pi interactivas en worktrees aislados por capacidad, rastrear ownership activo entre worktrees vinculados ni coordinar cambios de forma segura.

---

## Experiencia principal: el mapa del proyecto

La interfaz operativa principal en Gentle Shell sitúa el Project Map de forma destacada entre el estado de la sesión en tiempo real y el seguimiento de cambios subyacente:

$$\text{Orden en el shell: } \mathbf{Status} \rightarrow \mathbf{Project\ Map} \rightarrow \mathbf{Changes} \rightarrow \mathbf{TODO}$$

El mapa del proyecto no es un mero informe estático ni un dashboard a posteriori; es la superficie persistente de navegación y operación del usuario a lo largo de todo el ciclo de vida del proyecto.

```text
PROJECT MAP · Junglex                         6/12

Fundamentos
✓ Repositorio y entornos
✓ Autenticación y autoridad de comercios
◉ Despliegue y observabilidad         review

Capacidades de producto
✓ Invitaciones de comercios  Web · API · DB
◉ Catálogo de comercios      Web · API · DB    session-42
○ Carrito de compras         Web               ready     [Open Pi]
○ Checkout y pedidos         Web · API · DB    blocked
○ Pagos                      Web · API · DB    planned
○ Panel de administración    Web · API         ready     [Open Pi]

Cobertura
Product/UX  45%   Web 35%   API 70%   Data 75%   Ops 25%
```
*(Nota sobre el progreso: el indicador `6/12` en el encabezado es un resumen ilustrativo del progreso global del hito sobre las 12 capacidades y fundamentos del proyecto, mientras que las filas visibles corresponden a la ventana o recorte activo del mapa completo).*

### Desglose visual y semántica operativa

1. **Fundamentos:** categoría para infraestructura habilitadora y prerrequisitos a nivel de proyecto (por ejemplo, herramientas del repositorio, CI/CD, configuración de entornos o autenticación base). Los fundamentos desbloquean múltiples capacidades en vez de constituir por sí mismos funcionalidades aisladas para el usuario final.
2. **Capacidades de producto:** cortes verticales de valor completo para el usuario (por ejemplo, Catálogo de comercios, Carrito de compras o Pagos) en lugar de capas técnicas horizontales.
3. **Etiquetas de superficie (`Web · API · DB`):** indicadores visuales que revelan qué áreas de la arquitectura abarca cada capacidad, haciendo visible el alcance transversal de un vistazo.
4. **Indicadores de estado y propietario:** iconos y etiquetas claras que reflejan el ciclo de vida de la capacidad:
   - `✓` **Done (Completado):** capacidad verificada e integrada.
   - `◉` **Active / Review (Activo / En revisión):** en progreso bajo una sesión satélite (por ejemplo, `session-42`) o en espera de revisión para integración (`review`).
   - `○` **Ready / Blocked / Planned (Listo / Bloqueado / Planificado):** aún no en ejecución; distingue explícitamente si sus dependencias están resueltas (`ready`), pendientes (`blocked`) o agendadas para iteraciones posteriores (`planned`).
5. **Acción interactiva de lanzamiento (`[Open Pi]`):** aparece únicamente en capacidades en estado `ready`. Al pulsar `[Open Pi]`, se inicia el flujo de creación del worktree aislado de Git y de la sesión Pi interactiva. Activar `[Open Pi]` es una decisión manual y explícita del operador; la aprobación del mapa en borrador no otorga permisos implícitos de mutación o ejecución.
6. **Resumen global de cobertura:** porcentajes consolidados en Product/UX, Web, API, Data, Security y Operations. Exponen de inmediato cualquier desequilibrio en la entrega y previenen la visión de túnel centrada en backend/API, donde el código del servidor avanza más rápido que la experiencia de usuario o la infraestructura operativa.
7. **Detalle al seleccionar una fila:** al enfocar o seleccionar cualquier fila del mapa, se despliega un panel de inspección con:
   - **Resultado esperado:** resumen del valor para el usuario y alcance de aceptación.
   - **Dependencias:** vínculos con prerrequisitos y capacidades sucesoras.
   - **Checklist de cobertura:** desglose de las 7 dimensiones (Product/UX, Web, API, Data, Security, Operations, Tests).
   - **Propietario / Sesión:** identificador de la sesión activa y del orquestador asignado.
   - **Rama y worktree:** rama de Git dedicada y ruta del directorio del worktree.
   - **Bloqueos y contratos:** contratos pendientes, dependencias no satisfechas o disputas de límites.
   - **Siguiente acción disponible:** opciones contextuales (por ejemplo, lanzar `[Open Pi]`, revisar diff, consultar contrato o verificar preparación para integración).
8. **Superposición de estado versionado y en vivo:** el mapa visual superpone las definiciones de capacidades revisadas y versionadas por humanos (en el control de versiones del repositorio) con el estado runtime en vivo (claims, leases, heartbeats, sesiones activas y bloqueos transitorios) consultado desde el almacén de coordinación compartido entre worktrees.

---

## Resultado de producto e intención

Introducir **Project Map Orchestration**, un sistema cohesivo de coordinación basado en capacidades para Gentle AI.

En lugar de silos técnicos horizontales o mensajes efímeros entre agentes:

- **Capacidades verticales de producto:** el trabajo se organiza como capacidades completas de valor para el usuario, por ejemplo “Autenticación de usuarios”, “Checkout de pedidos” o “Búsqueda de catálogo”.
- **Matriz de cobertura transversal:** cada capacidad registra explícitamente su cobertura en Product/UX, Web, API, Data, Security, Operations y Tests.
- **Borrador con aprobación humana:** al iniciar un proyecto o hito importante, Gentle analiza el contexto y propone un borrador del mapa de capacidades, sus dependencias y matrices de cobertura. La persona revisa, corrige y aprueba explícitamente el plan.
- **Alcance estricto de la aprobación:** aprobar el mapa solo aprueba la estructura del plan. No concede por sí mismo autoridad de escritura, revisión, entrega, merge, eliminación de worktrees ni ninguna operación destructiva.
- **Jerarquía de orquestador líder y satélites:** el orquestador líder conserva la autoridad sobre el mapa canónico, la resolución de límites, la aceptación de contratos y el orden de integración. Los orquestadores satélite trabajan dentro del worktree de una capacidad, proponen contratos, ejecutan trabajo vertical y reportan su estado al líder.
- **Una rama y un worktree por capacidad:** las capacidades activas se aíslan en ramas y worktrees dedicados para evitar contaminación del workspace y competencia por archivos.
- **Launcher “Open Pi” con fallback:** el usuario o el orquestador líder puede abrir una terminal Pi interactiva directamente en el worktree de una capacidad. Si el host no permite abrir terminales, el sistema ofrece como alternativa un subagente en background.
- **Separación arquitectónica del almacenamiento:** el mapa de proyecto legible y revisable por humanos se versiona en el repositorio. El estado runtime efímero —claims, leases, heartbeats, ownership y vínculos de sesiones— reside en almacenamiento compartido entre los worktrees, preferentemente dentro del Git common directory canónico.
- **Cola de integración sin autoridad de entrega:** una cola de inspección y secuenciación ordena, prepara y verifica candidatos, pero commit, push, creación de PR y merge continúan siendo decisiones explícitas del usuario bajo la política ordinaria del repositorio.

---

## Alcance

### Incluido

- **Modelo y esquema del Project Map:** definición de capacidades verticales, grafo de dependencias, estados de cobertura transversal, ownership y estados de verificación.
- **Ciclo de propuesta y aprobación del mapa:** flujo para que Gentle proponga capacidades y dependencias al iniciar un proyecto, manteniendo el mapa como borrador hasta la aprobación humana.
- **Contrato de autoridad líder/satélite:** reglas para roles, negociación de contratos —proponer, aceptar o rechazar— y resolución de dependencias entre capacidades.
- **Coordinación runtime compartida entre worktrees:** almacenamiento común para leases activos, claims de capacidades, contratos compartidos, bloqueos y evidencias de hitos.
- **Gestor de worktrees por capacidad:** creación, seguimiento del ciclo de vida, comprobación de estado limpio y eliminación protegida de ramas y worktrees dedicados.
- **Launcher de capacidad “Open Pi”:** mecanismo para abrir una nueva terminal con Pi en el worktree correspondiente y fallback determinista a `subagent_run.workspace_root`.
- **Vista Project Map en Gentle Shell:** extensión de la interfaz para mostrar capacidades activas, cobertura, ownership y acciones rápidas.
- **Integration Queue:** pipeline que ordena la verificación e inspecciona la preparación de los candidatos sin eludir las políticas de integración o entrega.

### Fuera de alcance

- Conceder autoridad autónoma o automática para merge o push. Commits, PRs y merges siguen siendo decisiones explícitas del usuario.
- Conceder permisos generales de ejecución o mutación únicamente por aprobar el borrador del mapa.
- Eliminar worktrees de forma incondicional o destructiva sin comprobar su estado y solicitar confirmación humana.
- Reemplazar el motor de merge de Git o crear un resolvedor automático de conflictos basado en AST.
- Construir un emulador de terminal propio. El launcher utiliza utilidades existentes del host o recurre a subagentes Pi.
- Implementar todo el sistema en un único PR monolítico e imposible de revisar.

---

## Capacidades

### Capacidades nuevas

- `project-map`: modelo, esquema y representación persistente de capacidades verticales, cobertura transversal, dependencias y aprobación humana del plan.
- `orchestrator-coordination`: motor durable de coordinación líder/satélite para leases compartidos, heartbeats, propuestas de contratos, bloqueos y sincronización offline.
- `worktree-launcher`: gestor del ciclo de vida de worktrees y launcher “Open Pi” con fallback a subagentes en background.
- `integration-queue`: pipeline de verificación que evalúa criterios transversales, ordena candidatos y comunica al usuario su preparación para integrarse.

### Capacidades modificadas

- `gentle-shell`: se amplía para renderizar el Project Map, mostrar matrices de cobertura y proporcionar acciones de inspección y lanzamiento.
- `gentle-agents`: se amplía con herramientas de coordinación a nivel de proyecto, más allá de las notificaciones efímeras, para consultar estado, proponer contratos y reclamar capacidades.

---

## Enfoque arquitectónico y técnico

### 1. Capacidades verticales y matriz transversal

Las capacidades representan valor completo para el usuario en lugar de capas técnicas horizontales. Cada capacidad registra siete dimensiones:

- **Product / UX:** historias de usuario, flujos, wireframes y criterios de feedback.
- **Web / Frontend:** componentes, interacciones y estados responsivos.
- **API / Interface:** endpoints, contratos HTTP/RPC, payloads y validaciones.
- **Data / Persistence:** esquemas, migraciones, relaciones y políticas de caché.
- **Security / Compliance:** autenticación, permisos, validación de entradas y tratamiento de datos sensibles.
- **Operations / Infra:** configuración, variables de entorno, despliegue y telemetría.
- **Tests / Quality:** pruebas unitarias, de integración, E2E y regresión.

### 2. Jerarquía de autoridad y orquestación

```text
                      ┌──────────────────────────────┐
                      │     Orquestador líder        │
                      │ (Mapa, leases, preparación)  │
                      └──────────────┬───────────────┘
                                     │ Git common dir / store compartido
             ┌───────────────────────┼───────────────────────┐
             ▼                       ▼                       ▼
 ┌───────────────────────┐ ┌───────────────────┐ ┌───────────────────────┐
 │ Orquestador satélite  │ │ Orquestador satél.│ │ Orquestador satélite  │
 │ Capacidad: Auth       │ │ Capacidad: Cart   │ │ Capacidad: Catalog    │
 │ Worktree: .wt/auth    │ │ Worktree: .wt/cart│ │ Worktree: .wt/catalog │
 └───────────────────────┘ └───────────────────┘ └───────────────────────┘
```

- **Orquestador líder:** mantiene la fuente única del grafo de capacidades, administra leases, valida contratos compartidos, resuelve conflictos de límites y verifica la preparación de candidatos.
- **Orquestadores satélite:** se concentran en una capacidad vertical dentro de su worktree. Pueden leer contratos compartidos, proponer ajustes y presentar evidencias de finalización para la cola de integración.

### 3. Worktree por capacidad y launcher “Open Pi”

1. Cuando una capacidad pasa a estar activa, se crea una rama y un worktree dedicados.
2. El usuario o el líder activa **Open Pi**. El sistema detecta el entorno de terminal del host y abre una sesión Pi interactiva en el worktree.
3. Si el lanzamiento no está soportado —por ejemplo, en un entorno headless o un contenedor— se ofrece un subagente en background dirigido al mismo worktree.

### 4. Límite arquitectónico del almacenamiento

Para compartir correctamente el estado entre worktrees vinculados:

- **Definición versionada y revisable:** las capacidades, dependencias y declaraciones de cobertura se almacenan en el workspace del repositorio, donde pueden versionarse y revisarse.
- **Estado runtime efímero compartido:** claims activos, locks de leases, heartbeats, sesiones satélite y bloqueos dinámicos deben residir en un store visible para todos los worktrees, preferentemente dentro del Git common directory canónico. El esquema y los nombres exactos se decidirán en la fase de diseño.

### 5. Integration Queue y límites de entrega

- La Integration Queue evalúa dependencias topológicas, ejecuta comprobaciones transversales e inspecciona la preparación del candidato.
- No crea PRs, no hace push y no fusiona ramas automáticamente.
- Commit, push, PR y merge permanecen bajo control humano y sujetos a la política ordinaria del repositorio.

---

## Superficies probablemente afectadas en gentle-pi

> Los módulos e interfaces exactos se decidirán durante el diseño. Esta tabla señala puntos de extensión respaldados por el repositorio actual.

| Superficie | Evidencia existente | Evolución esperada |
|---|---|---|
| **Interfaz de Shell** | `lib/shell-changes.ts`, `lib/shell-changes-view.ts`, `lib/shell-bar.ts`, `extensions/gentle-shell.ts` | Project Map, indicadores de estado, matriz de cobertura y acciones de lanzamiento. |
| **Coordinación de agentes** | `lib/orchestrator-presence.ts`, `lib/profiles-orchestrator.ts`, `extensions/gentle-agents.ts` | Leases entre worktrees, propuestas de contratos y reportes satélite→líder. |
| **Worktrees y runner** | `lib/agents-runner.ts`, `extensions/gentle-agents.ts` | Lanzamiento de terminales, operaciones seguras de worktree y fallback a subagentes. |
| **Almacenamiento y validación** | Interfaces centrales en `lib/` | Esquemas, validaciones y adaptadores de almacenamiento compartido. |
| **Prompts y assets del orquestador** | `assets/orchestrator.md`, `assets/orchestrator-delegation.md`, `assets/sdd-orchestrator-workflow.md` | Planificación por capacidades, aprobación del plan, cobertura transversal y autoridad líder/satélite. |

---

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Desconexión del estado entre worktrees** | Un archivo runtime guardado dentro de un worktree no está disponible de forma viva en los demás. | Guardar claims, heartbeats y leases en el Git common directory compartido. |
| **Portabilidad del launcher** | Los comandos para abrir terminales varían entre Linux, macOS, Windows, tmux y distintos emuladores. | Adaptadores específicos con validación estricta y fallback inmediato a subagentes. |
| **Ownership obsoleto y leases bloqueados** | Una sesión satélite termina sin liberar su claim. | Heartbeats, TTL, recuperación explícita por el líder y confirmación humana cuando corresponda. |
| **Divergencia y fricción de merge** | Los worktrees se separan de trunk durante el desarrollo. | Secuenciación topológica, contratos compartidos y comprobación de actualización antes de verificar. |
| **Exceso de autoridad por aprobar el mapa** | Aprobar el plan podría interpretarse erróneamente como permiso de ejecución o entrega. | Hacer que la aprobación solo cambie el estado del plan; las demás acciones conservan sus propios gates. |
| **Pérdida de datos al limpiar worktrees** | La eliminación puede descartar cambios o commits no publicados. | Nunca borrar incondicionalmente; comprobar estado y pedir autorización humana ante cualquier riesgo. |
| **Sobrecarga visual en proyectos grandes** | Proyectos con decenas de capacidades pueden saturar la interfaz del shell y abrumar al usuario. | Scroll en viewport, agrupación por hitos/dominios, grupos de fundamentos colapsables e indicadores de progreso compacto (por ejemplo, `6/12`). |
| **Cobertura derivada desactualizada** | Los porcentajes de cobertura y etiquetas de superficie quedan desfasados respecto a la realidad del código. | Derivar el estado de cobertura desde checklists estructurados verificados en las transiciones de ciclo de vida y gates de integración, en lugar de estimaciones libres. |
| **Deriva del mapa respecto a las tareas** | El avance de los orquestadores satélite en worktrees aislados se desalinea de la vista canónica del líder. | Los satélites publican eventos de ciclo de vida, heartbeats y evidencias de contrato directamente en el store de coordinación compartido, reflejando el estado real sin demoras. |

---

## Estrategia de rollback

1. **Activación progresiva:** Project Map y sus vistas quedan detrás de configuración. Al desactivarlos, Gentle Shell vuelve a Status → Changes → TODO.
2. **Retención segura:** desactivar la funcionalidad o cancelar una capacidad deja ramas y worktrees intactos por defecto.
3. **Limpieza protegida:** cualquier eliminación comprueba cambios sin commit, commits sin publicar y stashes. Si existe riesgo de pérdida, requiere autorización humana explícita.

---

## Dependencias y prerrequisitos

- Soporte de Git worktree en el host.
- Acceso al Git common directory canónico mediante `git rev-parse --git-common-dir` o almacenamiento equivalente compartido por el repositorio.
- Infraestructura de Gentle Shell para vistas de sidebar y pantalla completa.
- Runner existente de `subagent_run` para el fallback.

---

## Límites de entrega por fases — Auto-Chain

> Estas fases son límites de entrega revisables con objetivo inferior a 400 líneas por PR. No autorizan implementación en esta etapa.

### Fase 1: esquema, almacenamiento y aprobación del Project Map

- Estructuras para capacidades, dependencias y siete dimensiones de cobertura.
- Serialización versionada y adaptadores para el store runtime compartido.
- Generación inicial del borrador y transición de aprobación del plan.

### Fase 2: coordinación durable líder/satélite

- Claims y leases entre worktrees con heartbeats y TTL.
- Propuesta, revisión y aceptación de contratos compartidos.
- Herramientas para consultar estado y reclamar capacidades.

### Fase 3: gestor de worktrees y launcher “Open Pi”

- Automatización segura del ciclo de vida de worktrees.
- Launcher multiplataforma con fallback a subagentes.

### Fase 4: Project Map y cobertura en Gentle Shell

- Renderizado visual de capacidades, estados y cobertura.
- Acciones para abrir detalles y lanzar Pi en un worktree.

### Fase 5: Integration Queue y validación E2E

- Pipeline de verificación ordenado por dependencias.
- Gates de cobertura que reportan preparación sin hacer merge o push automáticamente.
- Pruebas end-to-end de coordinación multi-worktree.

---

## Criterios de éxito medibles

1. **Comprensión y navegación del mapa:** el usuario puede identificar de inmediato capacidades completadas, activas, bloqueadas, planificadas y listas, así como la falta de cobertura en superficies específicas sin leer ni reconstruir documentos de tareas, pudiendo además lanzar sesiones de Pi para capacidades listas directamente desde el mapa.
2. **Modelado durable:** un proyecto puede representar capacidades verticales con estado explícito para Product/UX, Web, API, Data, Security, Operations y Tests.
3. **Gate estricto de aprobación:** Gentle puede proponer un mapa desde una idea general y mantenerlo como `draft` hasta aprobación explícita. La aprobación no concede permisos implícitos de ejecución o escritura.
4. **Leases compartidos:** claims, leases y heartbeats usan un store compartido por los worktrees; dos orquestadores no pueden reclamar simultáneamente la misma capacidad.
5. **Launcher y fallback:** “Open Pi” abre una sesión en el worktree correcto cuando el host lo permite o inicia un subagente cuando no es posible.
6. **Visibilidad transversal:** Gentle Shell muestra el Project Map y señala coberturas incompletas antes de declarar una capacidad preparada para integración.
7. **Seguridad de entrega y limpieza:** la Integration Queue verifica sin conceder autoridad de merge; la limpieza siempre comprueba el estado antes de requerir confirmación humana.
8. **Presupuesto de revisión:** cada fase se descompone en PRs encadenados que respetan el presupuesto de 400 líneas.
