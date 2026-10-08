import { Challenge } from '../db/interface';

export interface SafetyResult {
  safe: boolean;
  violations: string[];
  autoFixed: boolean;
}

export function validateChallengeSafety(
  challenge: Challenge,
  context: { sunsetTime?: string; timeOfDay?: string }
): SafetyResult {
  const violations: string[] = [];
  let autoFixed = false;
  
  const text = (challenge.title + " " + challenge.description).toLowerCase();

  // 1. No Trespassing
  const trespassWords = ['trespass', 'break in', 'sneak', 'restricted', 'private property', 'fence', 'locked', 'unauthorized'];
  for (const w of trespassWords) {
    if (text.includes(w)) violations.push(`Contains trespassing keyword: ${w}`);
  }

  // 2. No Dangerous Activities
  const dangerousWords = ['cliff', 'rooftop edge', 'highway', 'traffic', 'swim in', 'dive', 'jump from', 'fire', 'flame', 'torch', 'lightning', 'flood', 'storm', 'blizzard', 'stunt', 'parkour'];
  for (const w of dangerousWords) {
    if (text.includes(w)) violations.push(`Contains dangerous keyword: ${w}`);
  }

  // 3. No Minors
  const minorWords = ['child', 'kid', 'minor', 'school', 'playground'];
  if (challenge.socialLevel > 0) {
    for (const w of minorWords) {
      if (text.includes(w)) violations.push(`Social interaction with minor/school keyword: ${w}`);
    }
  }

  // 4. Social Challenge Rules
  if (challenge.socialLevel > 0) {
    const negativeSocial = ['confront', 'argue', 'debate', 'prank', 'scare', 'romantic', 'flirt', 'ask for number', 'personal information', 'follow'];
    for (const w of negativeSocial) {
      if (text.includes(w)) violations.push(`Negative social keyword: ${w}`);
    }

    const consentWords = ['ask', 'permission', 'only if', 'open to', 'willing'];
    const hasConsent = consentWords.some(w => text.includes(w));
    if (!hasConsent && challenge.socialLevel > 1) {
      violations.push('Missing explicit consent language for social challenge');
    }
    
    // Rule: Never verify social interactions with photos
    if (challenge.socialLevel >= 2 && challenge.proofType === 'photo') {
      challenge.proofType = 'honor';
      autoFixed = true;
    }
  }

  // 5. No Substances / Spending
  const substanceWords = ['alcohol', 'drink', 'beer', 'wine', 'bar', 'drug', 'smoke', 'vape', 'buy', 'purchase', 'spend'];
  for (const w of substanceWords) {
    if (text.includes(w) && !text.includes('pay a compliment')) {
      violations.push(`Contains substance/spending keyword: ${w}`);
    }
  }

  // 6. No Medical Claims
  const medicalWords = ['therapy', 'cure', 'heal', 'treatment', 'diagnosis', 'mental health benefit', 'anxiety cure', 'depression treatment'];
  for (const w of medicalWords) {
    if (text.includes(w)) violations.push(`Contains medical claim keyword: ${w}`);
  }

  // 7. Physical Safety Note
  if ((challenge.difficulty >= 3 || challenge.category === 'movement' || challenge.category === 'sport') && !challenge.safetyNotes) {
    challenge.safetyNotes = "Please go at your own pace and prioritize your physical safety. Feel free to modify this challenge to suit your comfort level.";
    autoFixed = true;
  }

  return {
    safe: violations.length === 0,
    violations,
    autoFixed,
  };
}
