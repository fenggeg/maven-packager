import {describe, expect, it} from 'vitest'
import {appendBoundedItems} from './boundedBuffer'

describe('appendBoundedItems', () => {
  it('keeps only the newest items when the buffer exceeds the limit', () => {
    expect(appendBoundedItems([1, 2, 3], [4, 5], 4)).toEqual([2, 3, 4, 5])
  })

  it('returns an empty buffer for non-positive limits', () => {
    expect(appendBoundedItems([1, 2], [3], 0)).toEqual([])
  })

  it('trims existing items even when no new item arrives', () => {
    expect(appendBoundedItems(['a', 'b', 'c'], [], 2)).toEqual(['b', 'c'])
  })
})
