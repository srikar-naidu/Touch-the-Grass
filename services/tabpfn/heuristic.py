def heuristic_score(candidate, history) -> float:
    score = 0.5
    
    # Difficulty adjustment
    score -= (candidate.difficulty - 3) * 0.1
    
    # Social adjustment (assuming comfort level is known, simplified here)
    score -= max(0, candidate.social_level - 1) * 0.15 
    
    # Streak bonus
    score += min(history.streak_days * 0.02, 0.1)
    
    # Category affinity
    score += (history.category_completion_rate - 0.5) * 0.2
    
    # Recent skip penalty
    score -= history.recent_skips * 0.03
    
    return max(0.1, min(0.95, score))
