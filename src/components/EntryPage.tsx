import type { CSSProperties, FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { AgentConfig } from "../types/agent";
import "./EntryPage.css";

type EntryPageProps = {
  agents: AgentConfig[];
  initialAgentName?: string;
  onConnect: (agent: AgentConfig) => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function EntryPage({
  agents,
  initialAgentName,
  onConnect,
}: EntryPageProps) {
  const [selectedName, setSelectedName] = useState<string>(
    initialAgentName ?? agents[0]?.name ?? "",
  );
  const [headRotateX, setHeadRotateX] = useState(0);
  const [headRotateY, setHeadRotateY] = useState(0);
  const [handOffset, setHandOffset] = useState(0);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.name === selectedName) ?? null,
    [agents, selectedName],
  );

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      const x = event.clientX / window.innerWidth;
      const y = event.clientY / window.innerHeight;
      setHeadRotateY(clamp((x - 0.5) * 28, -14, 14));
      setHeadRotateX(clamp((0.5 - y) * 20, -10, 10));
    }

    function handleScroll() {
      const nextOffset = Math.sin(window.scrollY / 36) * 10;
      setHandOffset(nextOffset);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAgent) return;
    onConnect(selectedAgent);
  }

  return (
    <section className="entry-page" aria-labelledby="entry-title">
      <div
        className="entry-hero"
        style={
          {
            "--robot-head-x": `${headRotateX.toFixed(1)}deg`,
            "--robot-head-y": `${headRotateY.toFixed(1)}deg`,
            "--robot-hand-shift": `${handOffset.toFixed(1)}px`,
            "--robot-eye-x": `${(headRotateY * 0.18).toFixed(1)}px`,
            "--robot-eye-y": `${(headRotateX * -0.2).toFixed(1)}px`,
          } as CSSProperties
        }
      >
        <div className="entry-robot" aria-hidden="true">
          <svg
            className="entry-robot-svg"
            viewBox="0 0 260 280"
            role="img"
            aria-label="Animated robot"
          >
            <defs>
              <linearGradient id="metalMain" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="#e2f0f7" />
                <stop offset="55%" stopColor="#6d8fa3" />
                <stop offset="100%" stopColor="#2a4454" />
              </linearGradient>
              <linearGradient id="metalDark" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#3b5f73" />
                <stop offset="100%" stopColor="#122735" />
              </linearGradient>
              <linearGradient id="visor" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#ffc77f" />
                <stop offset="100%" stopColor="#ff9d52" />
              </linearGradient>
              <radialGradient id="coreGlow" cx="50%" cy="45%" r="60%">
                <stop offset="0%" stopColor="#b9fff0" />
                <stop offset="100%" stopColor="#3d6d74" />
              </radialGradient>
              <filter id="robotShadow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="8" stdDeviation="7" floodColor="#000000" floodOpacity="0.35" />
              </filter>
            </defs>

            <g className="entry-robot-ant-group">
              <line x1="130" y1="18" x2="130" y2="40" className="entry-robot-ant-stem" />
              <circle cx="130" cy="14" r="6" className="entry-robot-ant-tip" />
            </g>

            <g className="entry-robot-arm-left">
              <circle cx="52" cy="152" r="12" className="entry-robot-joint" />
              <rect x="45" y="162" width="14" height="52" rx="7" className="entry-robot-limb" />
              <rect x="44" y="208" width="16" height="42" rx="8" className="entry-robot-limb-dark" />
              <rect x="43" y="247" width="2.5" height="16" rx="1" className="entry-robot-finger" />
              <rect x="57.5" y="247" width="2.5" height="16" rx="1" className="entry-robot-finger" />
            </g>

            <g className="entry-robot-arm-right">
              <circle cx="208" cy="152" r="12" className="entry-robot-joint" />
              <rect x="201" y="162" width="14" height="52" rx="7" className="entry-robot-limb" />
              <rect x="200" y="208" width="16" height="42" rx="8" className="entry-robot-limb-dark" />
              <rect x="199" y="247" width="2.5" height="16" rx="1" className="entry-robot-finger" />
              <rect x="213.5" y="247" width="2.5" height="16" rx="1" className="entry-robot-finger" />
            </g>

            <g className="entry-robot-body-group" filter="url(#robotShadow)">
              <rect x="64" y="124" width="132" height="106" rx="24" className="entry-robot-body-shell" />
              <rect x="83" y="145" width="94" height="36" rx="10" className="entry-robot-chest" />
              <rect x="96" y="155" width="68" height="11" rx="5" className="entry-robot-core" />
              <rect x="86" y="190" width="88" height="26" rx="8" className="entry-robot-grid" />
              <rect x="54" y="126" width="70" height="102" rx="16" className="entry-robot-specular entry-robot-specular--body" />
              <circle cx="76" cy="136" r="4" className="entry-robot-bolt" />
              <circle cx="184" cy="136" r="4" className="entry-robot-bolt" />
              <circle cx="76" cy="218" r="4" className="entry-robot-bolt" />
              <circle cx="184" cy="218" r="4" className="entry-robot-bolt" />
            </g>

            <rect x="112" y="110" width="36" height="16" rx="5" className="entry-robot-neck" />

            <g className="entry-robot-head-group" filter="url(#robotShadow)">
              <rect x="74" y="42" width="112" height="74" rx="15" className="entry-robot-head-shell" />
              <rect x="87" y="55" width="86" height="19" rx="9" className="entry-robot-brow" />
              <ellipse cx="111" cy="65" rx="18" ry="10" className="entry-robot-eye entry-robot-eye--left" />
              <ellipse cx="149" cy="65" rx="18" ry="10" className="entry-robot-eye entry-robot-eye--right" />
              <ellipse cx="111" cy="65" rx="18" ry="10" className="entry-robot-eyelid entry-robot-eyelid--left" />
              <ellipse cx="149" cy="65" rx="18" ry="10" className="entry-robot-eyelid entry-robot-eyelid--right" />
              <circle cx="111" cy="65" r="5.2" className="entry-robot-iris" />
              <circle cx="149" cy="65" r="5.2" className="entry-robot-iris" />
              <g className="entry-robot-pupil-group">
                <circle cx="111" cy="65" r="3.8" className="entry-robot-pupil" />
                <circle cx="149" cy="65" r="3.8" className="entry-robot-pupil" />
                <circle cx="113" cy="63" r="1.2" className="entry-robot-eye-glint" />
                <circle cx="151" cy="63" r="1.2" className="entry-robot-eye-glint" />
              </g>
              <rect x="64" y="44" width="52" height="70" rx="13" className="entry-robot-specular entry-robot-specular--head" />
              <rect x="108" y="85" width="44" height="12" rx="5" className="entry-robot-mouth" />
              <circle cx="95" cy="90" r="4" className="entry-robot-cheek" />
              <circle cx="165" cy="90" r="4" className="entry-robot-cheek" />
            </g>
          </svg>
        </div>

        <div className="entry-copy">
          <p className="entry-eyebrow">Connection Setup</p>
          <h1 id="entry-title">Axomoxoa AI Copilot</h1>
          <p>
            Select an agent connection and continue to the chatbot. Move your mouse
            to guide the robot and scroll to animate its hands.
          </p>
        </div>
      </div>

      <form className="entry-card" onSubmit={handleSubmit}>
        <fieldset className="entry-fieldset">
          <legend>Choose Agent</legend>
          {agents.map((agent) => (
            <label key={agent.name} className="entry-agent-option">
              <input
                type="radio"
                name="agent-selection"
                value={agent.name}
                checked={selectedName === agent.name}
                onChange={(event) => setSelectedName(event.target.value)}
              />
              <span className="entry-agent-name">{agent.name}</span>
              <span className="entry-agent-url">{agent.url}</span>
            </label>
          ))}
        </fieldset>

        <button type="submit" className="entry-connect-btn" disabled={!selectedAgent}>
          Connect To Chatbot
        </button>
      </form>

      <div className="entry-scroll-space" aria-hidden="true" />
    </section>
  );
}
