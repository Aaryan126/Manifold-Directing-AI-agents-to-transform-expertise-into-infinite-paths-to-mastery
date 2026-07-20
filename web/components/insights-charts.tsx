"use client";

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ActivityPoint = {
  date: string;
  attempts: number;
  active_learners: number;
};

type MasteryDistribution = {
  mastered: number;
  practiced: number;
  struggling: number;
  not_started: number;
};

type AnswerOutcomes = {
  attempts: number;
  confident_correct: number;
  unsure_correct: number;
  incorrect: number;
};

type ConceptReach = {
  concept_id: string;
  concept_name: string;
  touched_learners: number;
  struggling_learners: number;
};

type QuestionRisk = {
  question_id: string;
  prompt: string;
  attempts: number;
  incorrect_attempts: number;
  low_confidence_correct_attempts: number;
};

type InsightsChartsProps = {
  activity: ActivityPoint[];
  answerOutcomes: AnswerOutcomes;
  conceptReach: ConceptReach[];
  learnerCount: number;
  mastery: MasteryDistribution;
  questionRisk: QuestionRisk[];
};

const COLORS = {
  blue: "#2563eb",
  green: "#059669",
  mint: "#34d399",
  amber: "#f59e0b",
  red: "#ef4444",
  gray: "#d1d5db",
  ink: "#111827",
};

const tooltipStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  boxShadow: "0 8px 20px rgb(15 23 42 / 0.08)",
  fontSize: 12,
};

export function InsightsCharts({
  activity,
  answerOutcomes,
  conceptReach,
  learnerCount,
  mastery,
  questionRisk,
}: InsightsChartsProps) {
  const activityData = activity.map((point) => ({
    ...point,
    label: new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" })
      .format(new Date(`${point.date}T00:00:00Z`)),
  }));
  const outcomeData = [
    { name: "Confident correct", value: answerOutcomes.confident_correct, color: COLORS.green },
    { name: "Unsure correct", value: answerOutcomes.unsure_correct, color: COLORS.amber },
    { name: "Incorrect", value: answerOutcomes.incorrect, color: COLORS.red },
  ].filter((item) => item.value > 0);
  const masteryData = [
    { name: "Mastered", value: mastery.mastered, color: COLORS.green },
    { name: "Practiced", value: mastery.practiced, color: COLORS.blue },
    { name: "Struggling", value: mastery.struggling, color: COLORS.red },
    { name: "Not started", value: mastery.not_started, color: COLORS.gray },
  ].filter((item) => item.value > 0);
  const conceptData = conceptReach.slice(0, 6).map((item) => ({
    name: shorten(item.concept_name, 28),
    reached: Math.max(0, item.touched_learners - item.struggling_learners),
    struggling: item.struggling_learners,
  }));
  const riskData = questionRisk
    .filter((item) => item.attempts > 0)
    .slice(0, 5)
    .map((item) => ({
      name: shorten(item.prompt, 34),
      incorrect: item.incorrect_attempts,
      unsure: item.low_confidence_correct_attempts,
    }));

  return (
    <div className="grid gap-px bg-border lg:grid-cols-6">
      <ChartPanel className="lg:col-span-2" eyebrow="Last 14 days" title="Learning activity">
        <div className="h-64">
          <ResponsiveContainer height="100%" width="100%">
            <LineChart accessibilityLayer data={activityData} margin={{ bottom: 4, left: -24, right: 8, top: 12 }}>
              <CartesianGrid stroke="#eef0f3" strokeDasharray="3 3" vertical={false} />
              <XAxis axisLine={false} dataKey="label" fontSize={11} tickLine={false} />
              <YAxis allowDecimals={false} axisLine={false} fontSize={11} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Line activeDot={{ r: 4 }} dataKey="attempts" dot={false} name="Attempts" stroke={COLORS.blue} strokeWidth={2.5} type="monotone" />
              <Line dataKey="active_learners" dot={false} name="Active learners" stroke={COLORS.green} strokeDasharray="5 4" strokeWidth={2} type="monotone" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartPanel>

      <ChartPanel className="lg:col-span-2" eyebrow={`${answerOutcomes.attempts} graded`} title="Answer outcomes">
        {outcomeData.length ? (
          <DonutChart centerLabel={`${Math.round((answerOutcomes.confident_correct / answerOutcomes.attempts) * 100)}%`} centerSubLabel="confident" data={outcomeData} />
        ) : <EmptyChart label="No graded responses yet" />}
      </ChartPanel>

      <ChartPanel className="lg:col-span-2" eyebrow="Learner × concept" title="Mastery state">
        {masteryData.length ? (
          <DonutChart centerLabel={String(mastery.mastered)} centerSubLabel="mastered" data={masteryData} />
        ) : <EmptyChart label="Mastery starts after check-ins" />}
      </ChartPanel>

      <ChartPanel className="lg:col-span-3" eyebrow={`${learnerCount} enrolled`} title="Concept reach">
        {conceptData.length ? (
          <div className="h-72">
            <ResponsiveContainer height="100%" width="100%">
              <BarChart accessibilityLayer data={conceptData} layout="vertical" margin={{ bottom: 4, left: 12, right: 20, top: 8 }}>
                <CartesianGrid horizontal={false} stroke="#eef0f3" strokeDasharray="3 3" />
                <XAxis allowDecimals={false} axisLine={false} domain={[0, Math.max(1, learnerCount)]} fontSize={11} tickLine={false} type="number" />
                <YAxis axisLine={false} dataKey="name" fontSize={11} tickLine={false} type="category" width={190} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="reached" fill={COLORS.mint} name="Progressing" stackId="reach" />
                <Bar dataKey="struggling" fill={COLORS.red} name="Struggling" radius={[0, 3, 3, 0]} stackId="reach" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyChart label="No concept activity yet" />}
      </ChartPanel>

      <ChartPanel className="lg:col-span-3" eyebrow="Highest observed risk" title="Questions to watch">
        {riskData.length ? (
          <div className="h-72">
            <ResponsiveContainer height="100%" width="100%">
              <BarChart accessibilityLayer data={riskData} layout="vertical" margin={{ bottom: 4, left: 8, right: 12, top: 8 }}>
                <CartesianGrid horizontal={false} stroke="#eef0f3" strokeDasharray="3 3" />
                <XAxis allowDecimals={false} axisLine={false} fontSize={11} tickLine={false} type="number" />
                <YAxis axisLine={false} dataKey="name" fontSize={10} tickLine={false} type="category" width={125} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="unsure" fill={COLORS.amber} name="Unsure" stackId="risk" />
                <Bar dataKey="incorrect" fill={COLORS.red} name="Incorrect" radius={[0, 3, 3, 0]} stackId="risk" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <EmptyChart label="No question risk detected" />}
      </ChartPanel>
    </div>
  );
}

function DonutChart({
  centerLabel,
  centerSubLabel,
  data,
}: {
  centerLabel: string;
  centerSubLabel: string;
  data: Array<{ name: string; value: number; color: string }>;
}) {
  return (
    <div className="relative h-64">
      <ResponsiveContainer height="100%" width="100%">
        <PieChart accessibilityLayer>
          <Pie data={data} dataKey="value" innerRadius={58} nameKey="name" outerRadius={82} paddingAngle={2} stroke="none">
            {data.map((item) => <Cell fill={item.color} key={item.name} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
          <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 top-[82px] text-center">
        <p className="text-2xl font-semibold tabular-nums">{centerLabel}</p>
        <p className="text-[11px] text-muted-foreground">{centerSubLabel}</p>
      </div>
    </div>
  );
}

function ChartPanel({
  children,
  className = "",
  eyebrow,
  title,
}: {
  children: ReactNode;
  className?: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <section className={`min-w-0 bg-background px-6 py-5 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="text-[11px] text-muted-foreground">{eyebrow}</p>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function EmptyChart({ label }: { label: string }) {
  return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">{label}</div>;
}

function shorten(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
