// The one research chart: a declared numeric result column, bar-per-row,
// labelled by the run's axis values. It follows the metrics-charts doctrine
// to the letter — tree-shaken engine imports, no Legend/Title/Toolbox so the
// gallery-demo look physically cannot leak in, every colour from the page's
// own computed tokens, and the tooltip wearing our .mtip skin through a
// transparent engine container.

import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'

echarts.use([BarChart, GridComponent, TooltipComponent, SVGRenderer])

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

function readToken(name, fallback) {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/**
 * Build the rows the chart plots: one entry per table row that carries a
 * number in the chartable column, labelled by its axis values. Pure, so the
 * decision "is there anything to plot" is testable without a DOM.
 */
export function chartRows(model, column) {
  const rows = []
  for (const row of model.rows) {
    const value = row.cells[column.index]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const label = model.columns
      .map((name, index) => ({ name, value: row.cells[index] }))
      .filter(cell => cell.name !== column.name && cell.value !== null && cell.value !== undefined)
      .map(cell => String(cell.value))
      .join(' · ')
    rows.push({ label: label || row.runId, value })
  }
  return rows
}

/**
 * Mount the value-by-axis bar into `host`. Returns { resize, destroy } or
 * null when there is nothing numeric to plot — the caller then renders no
 * chart rather than an empty frame.
 */
export function createResultChart(host, { model, column }) {
  const rows = chartRows(model, column)
  if (rows.length === 0) return null
  const instance = echarts.init(host, null, { renderer: 'svg' })
  const ink2 = readToken('--ink-2', '#4f5f70')
  const grid = readToken('--chart-grid', 'rgba(14,23,38,0.07)')
  const bar = readToken('--chart-cross', 'rgba(14,23,38,0.24)')
  instance.setOption({
    animation: false,
    grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      appendToBody: true, confine: true, transitionDuration: 0, padding: 0, borderWidth: 0,
      backgroundColor: 'transparent', extraCssText: 'box-shadow:none;',
      formatter: params => `<div class="mtip">${esc(params.name)} — ${esc(column.name)} ${esc(params.value)}</div>`,
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: ink2, fontSize: 12 },
      splitLine: { lineStyle: { color: grid } },
    },
    yAxis: {
      type: 'category',
      data: rows.map(row => row.label),
      axisLabel: { color: ink2, fontSize: 12 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [{
      type: 'bar',
      data: rows.map(row => row.value),
      itemStyle: { color: bar },
      barMaxWidth: 18,
    }],
  })
  return {
    resize: () => instance.resize(),
    destroy: () => instance.dispose(),
  }
}
