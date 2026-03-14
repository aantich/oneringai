# NPC Character Behavior Framework

Design document for modeling NPC character behavior across RPG games, interactive fiction, world simulations, and narrative generation.

## Design Philosophy

Characters are driven by **stable psychological traits** that produce **emergent behavior** rather than scripted actions. The framework layers from immutable personality through derived state, goals, knowledge, and finally behavior resolution.

```
Personality (stable) → Derived State (flexible) → Goals (evolving) → Behavior (emergent)
                              ↑                         ↑
                        Memories, Relationships, Possessions
```

---

## Layer 1: Core Personality (Stable Traits)

These define **who the character is**. Set at creation, they change only through major life events (trauma, transformation arcs, supernatural influence).

### Big Five (OCEAN)

Industry-standard personality model. Each trait is a float from **-1.0 to 1.0**.

| Trait | Low (-1) | High (+1) |
|-------|----------|-----------|
| **Openness** | Conventional, practical, routine-oriented | Curious, creative, novelty-seeking |
| **Conscientiousness** | Carefree, spontaneous, disorganized | Disciplined, methodical, reliable |
| **Extraversion** | Reserved, solitary, reflective | Outgoing, energetic, talkative |
| **Agreeableness** | Competitive, skeptical, challenging | Cooperative, trusting, empathetic |
| **Neuroticism** | Emotionally stable, calm, resilient | Reactive, anxious, emotionally volatile |

### Moral Foundations

Based on Moral Foundations Theory (Haidt). Governs ethical decision-making. Float from **-1.0 to 1.0**.

| Foundation | Low (-1) | High (+1) |
|------------|----------|-----------|
| **Compassion** | Callous, indifferent to suffering | Empathetic, protective of the vulnerable |
| **Fairness** | Accepts inequality, might-makes-right | Egalitarian, justice-oriented |
| **Loyalty** | Individualist, self-reliant | Group-first, tribalistic |
| **Authority** | Rebellious, anti-hierarchical | Respects tradition, order, and rank |
| **Purity** | Pragmatic, secular | Values sanctity, tradition, taboos |

### Decision-Making Style

| Trait | Low (-1) | High (+1) |
|-------|----------|-----------|
| **Risk Tolerance** | Cautious, conservative, prefers safety | Bold, adventurous, embraces uncertainty |
| **Impulsivity** | Deliberate, plans ahead, weighs options | Spontaneous, acts on gut feeling |

### Data Model

```typescript
interface Personality {
  // Big Five (-1.0 to 1.0)
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;

  // Moral Foundations (-1.0 to 1.0)
  compassion: number;
  fairness: number;
  loyalty: number;
  authority: number;
  purity: number;

  // Decision-Making (-1.0 to 1.0)
  riskTolerance: number;
  impulsivity: number;
}
```

### Personality Archetypes (Examples)

| Archetype | O | C | E | A | N | Key Morals |
|-----------|---|---|---|---|---|------------|
| **Noble Knight** | 0.2 | 0.8 | 0.4 | 0.6 | -0.3 | compassion: 0.7, authority: 0.8 |
| **Cunning Rogue** | 0.7 | -0.3 | 0.5 | -0.4 | 0.2 | fairness: -0.5, loyalty: 0.6 |
| **Hermit Scholar** | 0.9 | 0.6 | -0.8 | 0.1 | 0.3 | purity: 0.5 |
| **Tyrant** | -0.3 | 0.7 | 0.6 | -0.8 | -0.2 | authority: 0.9, compassion: -0.8 |
| **Chaotic Trickster** | 0.8 | -0.7 | 0.9 | -0.2 | 0.5 | authority: -0.9, risk: 0.9 |

---

## Layer 2: Derived State (Flexible)

Computed from personality + recent events + context. Changes frequently — represents the character's **current condition**.

```typescript
type Emotion = 'joy' | 'anger' | 'fear' | 'sadness' | 'disgust' | 'surprise' | 'contempt' | 'neutral';

interface DerivedState {
  // Emotional state
  mood: Emotion;
  moodIntensity: number;       // 0.0 - 1.0
  moodDuration: number;        // remaining time units

  // Resource levels
  stress: number;              // 0.0 - 1.0 (affects decision quality)
  energy: number;              // 0.0 - 1.0 (physical/mental fatigue)
  motivation: number;          // 0.0 - 1.0 (drive to pursue goals)
  confidence: number;          // 0.0 - 1.0 (situational self-assessment)

  // Social state
  socialNeed: number;          // 0.0 - 1.0 (influenced by extraversion)
  reputationPerception: number; // -1.0 to 1.0 (how they think others see them)
}
```

### Derivation Rules (Examples)

- **socialNeed** decays faster for high-extraversion characters
- **stress** increases faster for high-neuroticism characters
- **confidence** baseline correlates with low neuroticism + high conscientiousness
- **mood** shifts are amplified by neuroticism, dampened by emotional stability
- After a **betrayal memory**, trust toward the betrayer drops; stress spikes proportional to neuroticism

---

## Layer 3: Goals

Goals form a hierarchy. Life goals beget long-term goals, which decompose into short-term goals, which produce immediate actions.

```typescript
type GoalType = 'life' | 'long_term' | 'short_term' | 'immediate';
type GoalStatus = 'active' | 'paused' | 'completed' | 'failed' | 'abandoned';

interface Goal {
  id: string;
  description: string;
  type: GoalType;
  status: GoalStatus;

  // Priority and progress
  priority: number;            // 0.0 - 1.0 (dynamic, recalculated)
  progress: number;            // 0.0 - 1.0
  deadline?: TimePoint;

  // Relationships to other goals
  parentGoal?: string;         // goal this serves
  subGoals: string[];          // goals that serve this one
  prerequisites: string[];     // must complete first
  conflicts: string[];         // goals that oppose this one

  // Origin
  drivenBy: string[];          // personality traits that generate this goal
  triggeredBy?: string;        // event or memory that created this goal

  // Completion criteria
  successCondition: string;    // evaluable description
  failureCondition?: string;
}
```

### Goal Generation from Personality

Life goals emerge from dominant personality traits:

| Dominant Traits | Example Life Goals |
|-----------------|--------------------|
| High openness + high risk tolerance | "Explore the unknown reaches of the world" |
| High conscientiousness + high authority | "Rise to a position of leadership" |
| High agreeableness + high compassion | "Protect the vulnerable and heal the sick" |
| Low agreeableness + low compassion | "Accumulate power and wealth at any cost" |
| High neuroticism + high loyalty | "Keep my family safe from all threats" |
| High openness + low authority | "Overthrow the corrupt establishment" |

### Goal Priority Recalculation

Priority is dynamic and influenced by:

1. **Urgency** — approaching deadline increases priority
2. **Threat** — goals related to survival spike when threatened
3. **Opportunity** — encountering a rare chance boosts related goals
4. **Mood** — anger boosts confrontation goals; fear boosts safety goals
5. **Personality** — conscientious characters stick to existing priorities; impulsive characters shift rapidly

---

## Layer 4: World Knowledge

### Memories

```typescript
interface Memory {
  id: string;
  description: string;           // what happened
  timestamp: TimePoint;
  location?: string;

  // Participants
  participants: EntityId[];
  perspectiveOf: EntityId;       // whose memory this is (subjective)

  // Emotional impact
  emotionalValence: number;      // -1.0 (traumatic) to +1.0 (cherished)
  emotionalTags: Emotion[];      // emotions felt during event
  importance: number;            // 0.0 - 1.0 (decays over time)

  // Categorization
  tags: string[];                // 'betrayal', 'gift', 'combat', 'loss', 'triumph', etc.

  // Links
  relatedGoals: string[];        // goals this memory is relevant to
  relatedMemories: string[];     // associated memories
}
```

**Memory decay**: `importance` decreases over time unless reinforced by recall or emotional intensity. High-valence memories (very positive or very negative) decay slower. Characters with high neuroticism retain negative memories longer.

### Relationships

```typescript
type RelationshipType =
  | 'family' | 'friend' | 'rival' | 'romantic' | 'professional'
  | 'enemy' | 'mentor' | 'subordinate' | 'acquaintance';

interface Relationship {
  targetId: EntityId;
  type: RelationshipType;

  // Core metrics (-1.0 to 1.0)
  disposition: number;           // overall feeling toward them
  trust: number;                 // reliability assessment
  respect: number;               // competence/status assessment
  intimacy: number;              // closeness / how well they know them

  // Dynamics
  powerBalance: number;          // -1.0 (they dominate) to 1.0 (I dominate)
  dependence: number;            // 0.0 - 1.0 (how much I need them)

  // History
  sharedMemories: string[];      // memory IDs
  lastInteraction: TimePoint;
  interactionCount: number;
}
```

### Possessions

```typescript
type PossessionCategory =
  | 'weapon' | 'armor' | 'tool' | 'keepsake' | 'wealth'
  | 'property' | 'document' | 'consumable' | 'clothing';

interface Possession {
  id: string;
  name: string;
  description: string;
  category: PossessionCategory;

  // Value assessment
  sentimentalValue: number;      // 0.0 - 1.0 (emotional attachment)
  utilityValue: number;          // 0.0 - 1.0 (practical usefulness)
  monetaryValue: number;         // abstract wealth units

  // Origin
  acquiredFrom?: EntityId;
  acquiredMemory?: string;       // memory of acquiring it

  // State
  condition: number;             // 0.0 (broken) to 1.0 (pristine)
}
```

### Knowledge & Beliefs

```typescript
interface Belief {
  id: string;
  subject: string;               // what the belief is about
  content: string;               // what they believe
  confidence: number;            // 0.0 - 1.0 (how sure they are)
  source: 'experience' | 'told' | 'inferred' | 'cultural';
  isTrue?: boolean;              // ground truth (hidden from character)
}
```

Characters can hold **false beliefs**. A character told "the king is just" may believe it with high confidence despite it being false. This drives dramatic irony and realistic social dynamics.

---

## Layer 5: Behavior Engine

Two primary loops govern NPC behavior at different time scales.

### Daily Planner (Strategic Loop)

Runs once per simulation day (or equivalent time period). Produces a rough schedule.

```
Input:  personality, derived_state, active_goals, relationships, time_of_day
Output: DailyPlan { blocks: ScheduleBlock[] }

Algorithm:
1. Sort active goals by recalculated priority
2. Select top N goals to pursue today (N influenced by conscientiousness)
3. For each goal, identify available actions toward it
4. Assign actions to time blocks (morning / afternoon / evening / night)
5. Apply personality filters:
   - Conscientious: sticks to plan, organized blocks
   - Impulsive: loose plan, likely to deviate
   - Extraverted: schedules social activities
   - Neurotic: builds in safety margins
6. Reserve time for basic needs (rest, food, social)
```

```typescript
interface ScheduleBlock {
  timeSlot: 'morning' | 'afternoon' | 'evening' | 'night';
  activity: string;
  relatedGoal?: string;
  location: string;
  flexibility: number;    // 0.0 (rigid) to 1.0 (easily interrupted)
  participants?: EntityId[];
}

interface DailyPlan {
  date: TimePoint;
  blocks: ScheduleBlock[];
  contingencies: string[];  // "if it rains, stay in the library"
}
```

### Encounter Resolver (Tactical Loop)

Triggered when the NPC encounters another entity or event. Produces a specific action.

```
Input:  personality, derived_state, goals, memories, relationship_with_other,
        situation_context, available_actions
Output: ChosenAction, updated_state

Algorithm:
1. ASSESS — Evaluate the situation
   - Who is involved? Check relationships.
   - What are the stakes? (physical danger, social, economic)
   - Pull relevant memories (past interactions with this person, similar situations)

2. DISPOSITION — Calculate action tendencies
   Each action type gets a weight derived from personality + context:

   fight:     f(low_agreeableness, risk_tolerance, anger, threat_level)
   flee:      f(neuroticism, low_risk_tolerance, fear, threat_level)
   negotiate: f(agreeableness, extraversion, trust_in_other)
   deceive:   f(low_compassion, openness, low_trust_in_other)
   help:      f(compassion, agreeableness, relationship_disposition)
   submit:    f(authority, low_confidence, power_imbalance)
   observe:   f(openness, conscientiousness, low_impulsivity)
   ignore:    f(low_extraversion, low_stakes)

3. MODIFY — Apply situational modifiers
   - Goal alignment: boost actions that serve active goals
   - Mood: anger → fight weight up; fear → flee weight up
   - Stress: high stress → impulsive choices (reduce deliberate options)
   - Relationship history: betrayal memories → reduce trust-based actions

4. SELECT — Weighted random choice from top actions
   - Not purely deterministic (characters surprise you)
   - But heavily biased by personality (they are recognizably themselves)

5. EXECUTE — Perform the action and resolve outcomes

6. UPDATE — Create new memory, update relationship, adjust mood
```

### Behavior Weight Formula (Pseudocode)

```typescript
function calculateActionWeights(
  npc: Character,
  situation: Situation,
  other: Character | null
): Map<ActionType, number> {
  const p = npc.personality;
  const s = npc.derivedState;
  const rel = other ? npc.getRelationship(other.id) : null;
  const threat = situation.threatLevel;       // 0-1
  const stakes = situation.stakes;            // 0-1
  const opportunity = situation.opportunity;  // 0-1

  const weights = new Map<ActionType, number>();

  // Fight / Confront
  weights.set('fight',
    0.20 * clamp(1 - p.agreeableness) +
    0.15 * clamp(p.riskTolerance) +
    0.15 * (s.mood === 'anger' ? s.moodIntensity : 0) +
    0.20 * threat +
    0.10 * clamp(1 - p.neuroticism) +
    0.10 * s.confidence +
    0.10 * (rel ? clamp(1 - rel.disposition) : 0.5)
  );

  // Flee / Avoid
  weights.set('flee',
    0.25 * clamp(p.neuroticism) +
    0.20 * clamp(1 - p.riskTolerance) +
    0.20 * (s.mood === 'fear' ? s.moodIntensity : 0) +
    0.20 * threat +
    0.15 * clamp(1 - s.confidence)
  );

  // Negotiate / Cooperate
  weights.set('negotiate',
    0.25 * clamp(p.agreeableness) +
    0.20 * clamp(p.extraversion) +
    0.15 * clamp(p.conscientiousness) +
    0.15 * (rel ? clamp(rel.trust) : 0.3) +
    0.15 * clamp(1 - p.impulsivity) +
    0.10 * clamp(p.fairness)
  );

  // Deceive / Manipulate
  weights.set('deceive',
    0.25 * clamp(1 - p.compassion) +
    0.20 * clamp(p.openness) +
    0.15 * clamp(1 - p.fairness) +
    0.15 * (rel ? clamp(1 - rel.trust) : 0.5) +
    0.15 * stakes +
    0.10 * clamp(1 - p.authority)
  );

  // Help / Support
  weights.set('help',
    0.30 * clamp(p.compassion) +
    0.25 * clamp(p.agreeableness) +
    0.20 * (rel ? clamp(rel.disposition) : 0.2) +
    0.15 * clamp(p.loyalty) +
    0.10 * (1 - threat)  // harder to help when threatened yourself
  );

  // Observe / Wait
  weights.set('observe',
    0.25 * clamp(p.openness) +
    0.25 * clamp(p.conscientiousness) +
    0.25 * clamp(1 - p.impulsivity) +
    0.15 * clamp(1 - p.extraversion) +
    0.10 * (1 - threat)
  );

  return weights;
}
```

---

## Character Composition

The full character model:

```typescript
interface Character {
  // Identity
  id: string;
  name: string;
  description: string;
  age: number;
  background: string;          // narrative backstory

  // Layer 1: Stable
  personality: Personality;

  // Layer 2: Current condition
  state: DerivedState;

  // Layer 3: Aspirations
  goals: Goal[];

  // Layer 4: World knowledge
  memories: Memory[];
  relationships: Relationship[];
  possessions: Possession[];
  beliefs: Belief[];

  // Layer 5: Behavior (computed)
  currentPlan?: DailyPlan;
}
```

---

## Simulation Tick Model

```
┌─────────────────────────────────────────┐
│              WORLD TICK                  │
│                                         │
│  For each NPC:                          │
│  1. Decay memory importance             │
│  2. Update derived state (energy, mood) │
│  3. Check schedule block                │
│  4. If encounter → run Encounter Loop   │
│  5. If no encounter → execute plan      │
│  6. Generate new memories from events   │
│  7. Update relationships if interacted  │
│                                         │
│  At day boundary:                       │
│  - Recalculate goal priorities          │
│  - Run Daily Planner                    │
│  - Restore energy (sleep)              │
│  - Decay stress                         │
└─────────────────────────────────────────┘
```

---

## Open Design Questions

1. **LLM Integration** — Should the behavior engine use LLM calls (feed personality + context as a prompt → get narrative action), stay purely algorithmic, or hybrid (algorithmic for routine, LLM for important moments)?

2. **Scale** — Dozens of deep NPCs or thousands of shallow ones? This affects whether we can afford LLM calls per decision and how much memory/relationship state we track.

3. **Output Format** — Is the output text narration, structured game actions, or both? This determines whether we need a natural language generation layer.

4. **Personality Drift** — Should traits shift slightly over long arcs (e.g., repeated betrayals slowly lower agreeableness), or remain truly fixed?

5. **Subjective vs Objective** — Should memories be objective (what happened) or subjective (what the character perceived)? Subjective is richer but harder to manage.

6. **Group Dynamics** — How do we model faction allegiance, mob mentality, and social pressure beyond pairwise relationships?

7. **Cultural Context** — Should there be a shared "culture" object that provides baseline moral foundations and beliefs for NPCs from the same background?

---

## Potential Extensions

- **Dialogue System** — Personality-driven dialogue tone, vocabulary, and willingness to share information
- **Skill/Ability Layer** — What the character _can_ do (separate from what they _want_ to do)
- **Economic Behavior** — Trading, pricing, employment decisions driven by personality + goals
- **Faction System** — Group-level goals and reputation that cascade to member NPCs
- **Narrative Arc Detection** — Identify when a character's trajectory matches known story patterns (hero's journey, fall from grace, redemption)
