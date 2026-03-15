// GoalType represents the temporal horizon of a goal
export type GoalType = 'life' | 'long_term' | 'short_term' | 'immediate';

// GoalStatus represents the current state of a goal
export type GoalStatus = 'active' | 'paused' | 'completed' | 'failed' | 'abandoned';

// Emotion represents the primary emotional states a character can experience
export type Emotion =
  | 'joy'
  | 'anger'
  | 'fear'
  | 'sadness'
  | 'disgust'
  | 'surprise'
  | 'contempt'
  | 'neutral';

// RelationshipType represents the nature of an interpersonal relationship
export type RelationshipType =
  | 'family'
  | 'friend'
  | 'rival'
  | 'romantic'
  | 'professional'
  | 'enemy'
  | 'mentor'
  | 'subordinate'
  | 'acquaintance';

// PossessionCategory classifies items a character owns
export type PossessionCategory =
  | 'weapon'
  | 'armor'
  | 'tool'
  | 'keepsake'
  | 'wealth'
  | 'property'
  | 'document'
  | 'consumable'
  | 'clothing';

// ActionType represents the possible actions a character can take in a situation
export type ActionType =
  | 'fight'
  | 'flee'
  | 'negotiate'
  | 'deceive'
  | 'help'
  | 'submit'
  | 'observe'
  | 'ignore';

// TimeSlot divides a day into four periods
export type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'night';

// BeliefSource describes how a character came to hold a belief
export type BeliefSource = 'experience' | 'told' | 'inferred' | 'cultural';
