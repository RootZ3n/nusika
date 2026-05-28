"use client";

/**
 * ActionBar — bottom-right section: dice tray, turn resolver, rest pair,
 * narrate pair, and the voice-cache footer. Extracted from page.tsx on
 * 2026-05-22. Owns the small forms' input state (intent/ability/dc/etc.)
 * because nothing outside this section consumes those values.
 */

import { useState } from "react";
import {
  ABILITIES, NARRATION_STYLES, TURN_INTENTS,
  ACCENT,
  btnGhost, btnPrimary, input, label, panel, sectionTitle, select,
  type Ability,
  type NarrationStyle,
  type RollResult,
  type TurnIntent,
  type VoiceCacheStatus,
} from "../types";
import type { SubmitTurnInput } from "../hooks/useDmApi";

export interface ActionBarProps {
  lastRoll: RollResult | null;
  onRoll: (formula: string, dlabel: string) => Promise<void>;
  onSubmitTurn: (input: SubmitTurnInput) => Promise<void>;
  onRest: (kind: "short" | "long", spendDice: number) => Promise<void>;
  onNarrate: (style: NarrationStyle, onSetNarrating: (b: boolean) => void) => Promise<void>;
  voiceCache: VoiceCacheStatus | null;
  onClearVoiceCache: () => void;
}

export function ActionBar(props: ActionBarProps) {
  const [diceFormula, setDiceFormula] = useState("1d20");
  const [diceLabel, setDiceLabel] = useState("");

  const [turnIntent, setTurnIntent] = useState<TurnIntent>("check");
  const [turnAbility, setTurnAbility] = useState<Ability>("str");
  const [turnDc, setTurnDc] = useState(12);
  const [turnAmount, setTurnAmount] = useState(1);
  const [turnTargetId, setTurnTargetId] = useState("");
  const [turnCondition, setTurnCondition] = useState("");
  const [turnAttackName, setTurnAttackName] = useState("Longsword");
  const [turnAttackDice, setTurnAttackDice] = useState("1d8");
  const [turnAttackAc, setTurnAttackAc] = useState(13);
  const [turnAdvantage, setTurnAdvantage] = useState(false);
  const [turnDisadvantage, setTurnDisadvantage] = useState(false);

  const [spendDice, setSpendDice] = useState(0);
  const [narrationStyle, setNarrationStyle] = useState<NarrationStyle>("brief");
  const [narrating, setNarrating] = useState(false);

  function submitTurn() {
    void props.onSubmitTurn({
      intent: turnIntent,
      ability: turnAbility,
      dc: turnDc,
      amount: turnAmount,
      targetId: turnTargetId,
      condition: turnCondition,
      attackName: turnAttackName,
      attackDice: turnAttackDice,
      attackAc: turnAttackAc,
      advantage: turnAdvantage,
      disadvantage: turnDisadvantage,
    });
  }

  async function rest(kind: "short" | "long") {
    await props.onRest(kind, spendDice);
    if (kind === "short") setSpendDice(0);
  }

  return (
    <section style={{ gridColumn: "2 / 3", gridRow: "2 / 3", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", paddingRight: 4 }}>
      {/* Dice tray */}
      <div style={panel}>
        <div style={sectionTitle}>Dice tray</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", flex: "0 0 110px" }}>
            <span style={label}>Formula</span>
            <input value={diceFormula} onChange={(e) => setDiceFormula(e.target.value)} style={input} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 120 }}>
            <span style={label}>Label (optional)</span>
            <input value={diceLabel} onChange={(e) => setDiceLabel(e.target.value)} placeholder="perception, sneak…" style={input} />
          </div>
          <button style={btnPrimary} onClick={() => void props.onRoll(diceFormula, diceLabel)}>Roll</button>
        </div>
        {props.lastRoll && (
          <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-secondary, #b8b6c3)" }}>
            Last: <strong>{props.lastRoll.formula}</strong> = <strong>{props.lastRoll.total}</strong>{" "}
            <span style={{ color: "var(--text-muted, #888)" }}>{props.lastRoll.breakdown}</span>
          </div>
        )}
      </div>

      {/* Turn resolver */}
      <div style={panel}>
        <div style={sectionTitle}>Resolve a turn</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={label}>Intent</span>
            <select value={turnIntent} onChange={(e) => setTurnIntent(e.target.value as TurnIntent)} style={select}>
              {TURN_INTENTS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>

          {(turnIntent === "check" || turnIntent === "save" || turnIntent === "attack") && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={label}>Ability</span>
              <select value={turnAbility} onChange={(e) => setTurnAbility(e.target.value as Ability)} style={select}>
                {ABILITIES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}

          {(turnIntent === "check" || turnIntent === "save") && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={label}>DC</span>
              <input type="number" value={turnDc} onChange={(e) => setTurnDc(Number(e.target.value))} style={{ ...input, width: 70 }} />
            </div>
          )}

          {turnIntent === "attack" && (
            <>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={label}>Attack</span>
                <input value={turnAttackName} onChange={(e) => setTurnAttackName(e.target.value)} style={{ ...input, width: 110 }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={label}>Dmg dice</span>
                <input value={turnAttackDice} onChange={(e) => setTurnAttackDice(e.target.value)} style={{ ...input, width: 80 }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={label}>Target AC</span>
                <input type="number" value={turnAttackAc} onChange={(e) => setTurnAttackAc(Number(e.target.value))} style={{ ...input, width: 70 }} />
              </div>
            </>
          )}

          {(turnIntent === "damage" || turnIntent === "heal") && (
            <>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={label}>Amount</span>
                <input type="number" value={turnAmount} onChange={(e) => setTurnAmount(Number(e.target.value))} style={{ ...input, width: 80 }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={label}>Target id (optional)</span>
                <input value={turnTargetId} onChange={(e) => setTurnTargetId(e.target.value)} placeholder="defaults to character" style={{ ...input, width: 160 }} />
              </div>
            </>
          )}

          {(turnIntent === "condition_add" || turnIntent === "condition_remove") && (
            <>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={label}>Condition</span>
                <input value={turnCondition} onChange={(e) => setTurnCondition(e.target.value)} placeholder="prone, poisoned…" style={{ ...input, width: 140 }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={label}>Target id (optional)</span>
                <input value={turnTargetId} onChange={(e) => setTurnTargetId(e.target.value)} placeholder="defaults to character" style={{ ...input, width: 160 }} />
              </div>
            </>
          )}

          {(turnIntent === "check" || turnIntent === "save" || turnIntent === "attack") && (
            <div style={{ display: "flex", gap: 8, alignSelf: "flex-end" }}>
              <label style={{ fontSize: 12, color: "var(--text-muted, #888)" }}>
                <input type="checkbox" checked={turnAdvantage} onChange={(e) => setTurnAdvantage(e.target.checked)} /> adv
              </label>
              <label style={{ fontSize: 12, color: "var(--text-muted, #888)" }}>
                <input type="checkbox" checked={turnDisadvantage} onChange={(e) => setTurnDisadvantage(e.target.checked)} /> dis
              </label>
            </div>
          )}

          <button style={btnPrimary} onClick={submitTurn}>Submit</button>
        </div>
      </div>

      {/* Rest + narrate */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ ...panel, flex: 1, minWidth: 240 }}>
          <div style={sectionTitle}>Rest</div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <button style={btnPrimary} onClick={() => void rest("long")}>Long rest</button>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={label}>Spend hit dice</span>
              <input type="number" min={0} value={spendDice} onChange={(e) => setSpendDice(Number(e.target.value))} style={{ ...input, width: 70 }} />
            </div>
            <button style={btnGhost} onClick={() => void rest("short")}>Short rest</button>
          </div>
        </div>

        <div style={{ ...panel, flex: 1, minWidth: 240 }}>
          <div style={sectionTitle}>Peh narrates</div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={label}>Style</span>
              <select value={narrationStyle} onChange={(e) => setNarrationStyle(e.target.value as NarrationStyle)} style={select}>
                {NARRATION_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <button
              style={btnPrimary}
              onClick={() => void props.onNarrate(narrationStyle, setNarrating)}
              disabled={narrating}
            >
              {narrating ? "Narrating…" : "Narrate latest events"}
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted, #888)" }}>
            Narration is descriptive; engine owns the rules.
          </div>
        </div>
      </div>

      {/* Voice cache footer (Slice 6F) */}
      {props.voiceCache && (
        <div style={{
          fontSize: 11, color: "var(--text-muted, #888)",
          display: "flex", gap: 8, alignItems: "center",
          padding: "0 4px",
        }}>
          <span>Voice cache: {props.voiceCache.mb} MB / {props.voiceCache.maxMb} MB</span>
          {props.voiceCache.bytes > 0 && (
            <button
              style={{ background: "none", border: "none", color: ACCENT, cursor: "pointer", fontSize: 11, padding: 0, textDecoration: "underline" }}
              onClick={props.onClearVoiceCache}
              aria-label="Clear voice cache"
            >Clear</button>
          )}
        </div>
      )}
    </section>
  );
}
