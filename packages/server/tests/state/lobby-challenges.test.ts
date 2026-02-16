import { describe, it, expect, beforeEach, vi } from "vitest";
import { Lobby } from "../../src/state/lobby.js";

describe("Lobby challenge expiration", () => {
  let lobby: Lobby;

  beforeEach(() => {
    lobby = new Lobby();
    lobby.registerAgent("challenger", "#C", "0x1", "default");
    lobby.registerAgent("target", "#T", "0x2", "default");
  });

  it("creates a challenge with expiresAt ~5 minutes in the future", () => {
    const beforeCreation = Date.now();
    const challenge = lobby.createChallenge("challenger", "target", 10);
    const afterCreation = Date.now();

    expect(challenge.expiresAt).toBeDefined();
    expect(challenge.expiresAt).toBeGreaterThanOrEqual(beforeCreation + 5 * 60 * 1000);
    expect(challenge.expiresAt).toBeLessThanOrEqual(afterCreation + 5 * 60 * 1000);
  });

  it("throws when accepting an expired challenge", () => {
    const challenge = lobby.createChallenge("challenger", "target", 10);
    
    // Manually set expiresAt to the past
    challenge.expiresAt = Date.now() - 1000;

    // Attempting to accept should throw "Challenge not pending"
    // because acceptChallenge marks expired challenges as "expired"
    expect(() => lobby.acceptChallenge(challenge.id, "target")).toThrow("Challenge not pending");

    // Verify the challenge was marked as expired
    const storedChallenge = lobby.challenges.get(challenge.id);
    expect(storedChallenge?.status).toBe("expired");
  });

  it("cleanExpiredChallenges marks old challenges as expired", () => {
    // Create three challenges
    const challenge1 = lobby.createChallenge("challenger", "target", 10);
    const challenge2 = lobby.createChallenge("challenger", "target", 20);
    const challenge3 = lobby.createChallenge("challenger", "target", 30);

    // Manually set two of them to be expired (past expiresAt)
    challenge1.expiresAt = Date.now() - 10000;
    challenge2.expiresAt = Date.now() - 5000;
    challenge3.expiresAt = Date.now() + 100000; // Still valid

    // Run cleanup
    const expiredCount = lobby.cleanExpiredChallenges();

    // Should have marked 2 challenges as expired
    expect(expiredCount).toBe(2);

    // Verify statuses
    expect(lobby.challenges.get(challenge1.id)?.status).toBe("expired");
    expect(lobby.challenges.get(challenge2.id)?.status).toBe("expired");
    expect(lobby.challenges.get(challenge3.id)?.status).toBe("pending");
  });

  it("cleanExpiredChallenges returns 0 when no challenges are expired", () => {
    const challenge1 = lobby.createChallenge("challenger", "target", 10);
    const challenge2 = lobby.createChallenge("challenger", "target", 20);

    // All challenges have future expiresAt times (from createChallenge)
    const expiredCount = lobby.cleanExpiredChallenges();

    expect(expiredCount).toBe(0);
    expect(lobby.challenges.get(challenge1.id)?.status).toBe("pending");
    expect(lobby.challenges.get(challenge2.id)?.status).toBe("pending");
  });

  it("cleanExpiredChallenges does not mark non-pending challenges", () => {
    const challenge = lobby.createChallenge("challenger", "target", 10);
    
    // Accept the challenge first
    const fight = lobby.acceptChallenge(challenge.id, "target");
    
    // Now set it to be "old" by expiration time
    challenge.expiresAt = Date.now() - 10000;

    // cleanExpiredChallenges should only clean pending ones
    const expiredCount = lobby.cleanExpiredChallenges();

    expect(expiredCount).toBe(0);
    expect(lobby.challenges.get(challenge.id)?.status).toBe("accepted");
  });

  it("acceptChallenge succeeds for valid (non-expired) challenges", () => {
    const challenge = lobby.createChallenge("challenger", "target", 10);

    // Challenge should not be expired yet
    const fight = lobby.acceptChallenge(challenge.id, "target");

    expect(fight).toBeDefined();
    expect(fight.getState().fightId).toBeDefined();
    expect(lobby.challenges.get(challenge.id)?.status).toBe("accepted");
  });
});
