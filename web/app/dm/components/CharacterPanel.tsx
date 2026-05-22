"use client";

/**
 * CharacterPanel — combines the level-1 create form and the read-only
 * sheet view. Extracted from page.tsx on 2026-05-22.
 *
 * The original page rendered <CharacterCreateForm> when `character` was
 * null and <CharacterSheet> otherwise. That switch lives here now so the
 * page only has to pass a single `character` + `onCreate` pair.
 */

import { useState } from "react";
import {
  ABILITIES,
  ACCENT,
  SRD_CLASSES,
  btnPrimary, input, label as labelStyle, panel, sectionTitle, select,
  type Ability,
  type AbilityScores,
  type Character,
  type SrdClass,
} from "../types";
import type { CreateCharacterInput } from "../hooks/useDmApi";

export interface CharacterPanelProps {
  character: Character | null;
  onCreate: (input: CreateCharacterInput) => Promise<boolean>;
}

export function CharacterPanel(props: CharacterPanelProps) {
  return (
    <section style={{ ...panel, gridColumn: "1 / 2", gridRow: "1 / 3", display: "flex", flexDirection: "column", overflow: "auto" }}>
      <div style={sectionTitle}>Character</div>
      {!props.character && <CharacterCreateForm onCreate={props.onCreate} />}
      {props.character && <CharacterSheet character={props.character} />}
    </section>
  );
}

interface CharacterCreateFormProps {
  onCreate: (input: CreateCharacterInput) => Promise<boolean>;
}

function CharacterCreateForm({ onCreate }: CharacterCreateFormProps) {
  const [name, setName] = useState("");
  const [ancestry, setAncestry] = useState("human");
  const [cls, setCls] = useState<SrdClass>("fighter");
  const [background, setBackground] = useState("");
  const [abilities, setAbilities] = useState<AbilityScores>({
    str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8,
  });

  const setAbility = (k: Ability, v: number) =>
    setAbilities({ ...abilities, [k]: v });

  async function submit() {
    const ok = await onCreate({ name, ancestry, cls, background, abilities });
    if (ok) setName("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 13, color: "var(--text-muted, #888)", lineHeight: 1.5 }}>
        Create a level-1 character. The engine will set HP, AC, and hit dice from your class and CON.
      </div>

      <label style={{ display: "flex", flexDirection: "column" }}>
        <span style={labelStyle}>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} style={input} />
      </label>

      <label style={{ display: "flex", flexDirection: "column" }}>
        <span style={labelStyle}>Ancestry</span>
        <input value={ancestry} onChange={(e) => setAncestry(e.target.value)} style={input} />
      </label>

      <label style={{ display: "flex", flexDirection: "column" }}>
        <span style={labelStyle}>Class</span>
        <select value={cls} onChange={(e) => setCls(e.target.value as SrdClass)} style={select}>
          {SRD_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column" }}>
        <span style={labelStyle}>Background (optional)</span>
        <input value={background} onChange={(e) => setBackground(e.target.value)} style={input} />
      </label>

      <div>
        <span style={labelStyle}>Abilities</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {ABILITIES.map((a) => (
            <label key={a} style={{ display: "flex", flexDirection: "column", fontSize: 11, color: "var(--text-muted, #888)" }}>
              {a.toUpperCase()}
              <input type="number" min={1} max={20} value={abilities[a]} onChange={(e) => setAbility(a, Number(e.target.value))} style={{ ...input, padding: "5px 8px" }} />
            </label>
          ))}
        </div>
      </div>

      <button style={btnPrimary} onClick={() => void submit()}>Create character</button>
    </div>
  );
}

function CharacterSheet({ character }: { character: Character }) {
  const c = character;
  const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 };
  const muted: React.CSSProperties = { color: "var(--text-muted, #888)" };

  const equipped = (c.inventory ?? []).filter((i) => i.equipped);
  const carried = (c.inventory ?? []).filter((i) => !i.equipped);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{c.name}</div>
      <div style={{ fontSize: 12, color: "var(--text-muted, #888)" }}>
        {c.ancestry} {c.class_name} · level {c.level}{c.background ? ` · ${c.background}` : ""}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 8 }}>
        <div style={row}><span style={muted}>HP</span><strong>{c.hp_current}/{c.hp_max}{c.hp_temp ? ` (+${c.hp_temp})` : ""}</strong></div>
        <div style={row}><span style={muted}>AC</span><strong>{c.ac}</strong></div>
        <div style={row}><span style={muted}>Speed</span><strong>{c.speed}</strong></div>
        <div style={row}><span style={muted}>Prof</span><strong>+{c.proficiency_bonus}</strong></div>
        <div style={row}><span style={muted}>XP</span><strong>{c.xp}</strong></div>
        <div style={row}><span style={muted}>Hit dice</span><strong>{c.hit_dice.remaining}/{c.hit_dice.total} {c.hit_dice.die}</strong></div>
      </div>

      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted, #888)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Abilities</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4, fontSize: 13 }}>
          {ABILITIES.map((a) => {
            const score = c.abilities[a];
            const mod = Math.floor((score - 10) / 2);
            return (
              <div key={a} style={{ textAlign: "center", padding: "4px 0", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: "var(--text-muted, #888)", textTransform: "uppercase" }}>{a}</div>
                <div style={{ fontWeight: 600 }}>{score}</div>
                <div style={{ fontSize: 11, color: ACCENT }}>{mod >= 0 ? `+${mod}` : mod}</div>
              </div>
            );
          })}
        </div>
      </div>

      {c.conditions.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted, #888)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Conditions</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {c.conditions.map((k) => (
              <span key={k} style={{ background: "rgba(248,113,113,0.1)", color: "#fca5a5", border: "1px solid rgba(248,113,113,0.3)", padding: "2px 8px", borderRadius: 12, fontSize: 11 }}>
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {(c.death_saves.successes > 0 || c.death_saves.failures > 0) && (
        <div style={{ fontSize: 12, color: "var(--text-muted, #888)" }}>
          Death saves: ✓ {c.death_saves.successes} / ✗ {c.death_saves.failures}
        </div>
      )}

      {(equipped.length > 0 || carried.length > 0) && (
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted, #888)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
            Inventory
          </div>
          {equipped.length > 0 && (
            <ul style={{ fontSize: 12, paddingLeft: 18, margin: "2px 0" }}>
              {equipped.map((i, idx) => (
                <li key={i.id ?? idx}><strong>{i.name}</strong>{i.quantity && i.quantity > 1 ? ` ×${i.quantity}` : ""} <span style={muted}>(equipped)</span></li>
              ))}
            </ul>
          )}
          {carried.length > 0 && (
            <ul style={{ fontSize: 12, paddingLeft: 18, margin: "2px 0", color: "var(--text-secondary, #b8b6c3)" }}>
              {carried.map((i, idx) => (
                <li key={i.id ?? idx}>{i.name}{i.quantity && i.quantity > 1 ? ` ×${i.quantity}` : ""}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
