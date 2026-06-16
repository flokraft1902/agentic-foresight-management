from __future__ import annotations

from dataclasses import dataclass

from app.config import settings

try:
    from crewai import Agent, Crew, LLM, Process, Task  # type: ignore
except Exception:  # pragma: no cover
    Agent = None
    Crew = None
    LLM = None
    Process = None
    Task = None


@dataclass
class CrewSummary:
    used_crewai: bool
    text: str


@dataclass
class LLMProbe:
    ok: bool
    status: str
    detail: str


def probe_llm() -> LLMProbe:
    if not settings.llm_api_key:
        return LLMProbe(ok=False, status="no_api_key", detail="LLM_API_KEY is not set in .env.")
    if LLM is None:
        return LLMProbe(
            ok=False,
            status="crewai_missing",
            detail="CrewAI runtime is not installed; cannot reach the LLM.",
        )

    try:
        from litellm import completion  # type: ignore
    except Exception as exc:
        return LLMProbe(ok=False, status="litellm_missing", detail=f"litellm import failed: {exc}")

    try:
        response = completion(
            model=settings.llm_model,
            api_key=settings.llm_api_key,
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=5,
        )
        text = ""
        try:
            text = response.choices[0].message.content or ""
        except Exception:
            text = str(response)[:120]
        return LLMProbe(ok=True, status="live", detail=f"LLM reachable. Reply: {text.strip()[:120]}")
    except Exception as exc:
        return LLMProbe(ok=False, status="probe_failed", detail=str(exc)[:400])


def summarize_stage(stage_name: str, objective: str, payload: dict) -> CrewSummary:
    has_llm_config = bool(settings.llm_api_key and settings.llm_model)
    has_crewai = all(item is not None for item in [Agent, Crew, Process, Task])

    if not (has_llm_config and has_crewai):
        return CrewSummary(
            used_crewai=False,
            text=(
                f"Fallback mode for stage '{stage_name}'. "
                "CrewAI summary skipped because LLM_API_KEY or CrewAI runtime is not available."
            ),
        )

    llm = LLM(model=settings.llm_model, api_key=settings.llm_api_key) if LLM else None
    agent_kwargs = {"llm": llm} if llm else {}

    analyst = Agent(
        role=f"{stage_name} analyst",
        goal=objective,
        backstory="You are part of a foresight multi-agent system and summarize one workflow stage.",
        verbose=False,
        allow_delegation=False,
        **agent_kwargs,
    )

    task = Task(
        description=(
            f"Summarize the following structured payload for stage '{stage_name}'. "
            "Highlight key findings, uncertainties, and potential review actions.\n\n"
            f"Payload: {payload}"
        ),
        expected_output=(
            "A concise, structured summary with sections: findings, uncertainty, "
            "and reviewer checkpoints."
        ),
        agent=analyst,
    )

    crew = Crew(
        agents=[analyst],
        tasks=[task],
        process=Process.sequential,
        verbose=False,
    )

    result = crew.kickoff()
    return CrewSummary(used_crewai=True, text=str(result))
