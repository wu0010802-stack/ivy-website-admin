import { describe, expect, it } from 'vitest'
import { dayLightFor } from '../app/utils/dayLight'
import fixture from '../server/data/site-fixture.json'

describe('dayLightFor', () => {
  it('依時間分成早上、中午、午後、傍晚', () => {
    expect(dayLightFor('08:00')).toBe('morning')
    expect(dayLightFor('8:05')).toBe('morning')
    expect(dayLightFor('09:59')).toBe('morning')
    expect(dayLightFor('10:00')).toBe('noon')
    expect(dayLightFor('12:59')).toBe('noon')
    expect(dayLightFor('13:00')).toBe('afternoon')
    expect(dayLightFor('16:00')).toBe('dusk')
  })

  it('沒有時間或格式不對時不加光', () => {
    expect(dayLightFor(undefined)).toBe('none')
    expect(dayLightFor('')).toBe('none')
    expect(dayLightFor('早上')).toBe('none')
  })

  it('預設六張卡從早上走到傍晚', () => {
    const { moments } = (fixture as unknown as { dayExperience: { moments: { time: string }[] } }).dayExperience
    expect(moments.map(m => dayLightFor(m.time))).toEqual(['morning', 'morning', 'noon', 'noon', 'afternoon', 'dusk'])
  })
})
