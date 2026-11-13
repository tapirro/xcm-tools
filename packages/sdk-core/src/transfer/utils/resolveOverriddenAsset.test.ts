import type { TAsset, TAssetInfo } from '@paraspell/assets'
import { isAssetEqual, normalizeLocation } from '@paraspell/assets'
import type { TLocation } from '@paraspell/sdk-common'
import { isTLocation, Version } from '@paraspell/sdk-common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PolkadotApi } from '../../api'
import type { TSubstrateTransferOptions } from '../../types'
import { abstractDecimals, createAsset, pickCompatibleXcmVersion, sortAssets } from '../../utils'
import { resolveOverriddenAsset } from './resolveOverriddenAsset'
import { validateAssetSupport } from './validateAssetSupport'

vi.mock('../../utils')
vi.mock('./validateAssetSupport')

vi.mock('@paraspell/sdk-common')
vi.mock('@paraspell/assets', () => ({
  isAssetEqual: vi.fn(),
  extractAssetLocation: vi.fn().mockResolvedValue({}),
  normalizeLocation: vi.fn((location: TLocation) => location),
  InvalidCurrencyError: class extends Error {}
}))

describe('resolveOverriddenAsset', () => {
  const mockOrigin = 'Acala'
  const mockDestination = {} as TLocation

  const mockApi = {
    findAssetInfo: vi.fn()
  } as unknown as PolkadotApi<unknown, unknown, unknown>

  const defaultOptions = {
    api: mockApi,
    currency: { symbol: 'TEST', amount: '1000' },
    from: mockOrigin,
    to: mockDestination
  } as TSubstrateTransferOptions<unknown, unknown, unknown>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(isTLocation).mockReturnValue(false)
    vi.mocked(createAsset).mockReturnValue({} as TAsset)
    vi.mocked(pickCompatibleXcmVersion).mockReturnValue(Version.V5)
    vi.mocked(normalizeLocation).mockImplementation(location => location)
    vi.spyOn(mockApi, 'findAssetInfo').mockReturnValue({
      location: {}
    } as TAssetInfo)
    vi.mocked(abstractDecimals).mockImplementation(amount => BigInt(amount))
    vi.mocked(sortAssets).mockImplementation(assets => assets)
  })

  it('resolves currencies by fetching assets when not all items are TAsset', () => {
    const assets = [
      { symbol: 'ASSET1', amount: 1000n },
      { symbol: 'ASSET2', amount: 2000n }
    ]
    const options = {
      ...defaultOptions,
      currency: assets,
      feeAsset: { symbol: 'ASSET2' }
    }

    vi.mocked(isTLocation).mockReturnValue(false)
    vi.mocked(isAssetEqual).mockReturnValueOnce(false).mockReturnValueOnce(true)

    const spy = vi.spyOn(mockApi, 'findAssetInfo')

    const result = resolveOverriddenAsset(options, false, true, { symbol: 'DOT' } as TAssetInfo)

    expect(validateAssetSupport).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenCalledTimes(assets.length)
    expect(createAsset).toHaveBeenCalledTimes(assets.length)
    expect(result).toEqual([
      {
        isFeeAsset: false
      },
      {
        isFeeAsset: true
      }
    ])
  })

  it('uses pickCompatibleXcmVersion and normalizes asset locations for negotiated/overridden V3 transfers', () => {
    const v5Location: TLocation = {
      parents: 1,
      interior: { X1: [{ Parachain: 2006 }] }
    }
    const v3NormalizedLocation: TLocation = {
      parents: 1,
      interior: { X1: { Parachain: 2006 } }
    }

    vi.mocked(pickCompatibleXcmVersion).mockReturnValue(Version.V3)
    vi.mocked(normalizeLocation).mockReturnValue(v3NormalizedLocation)
    vi.mocked(isAssetEqual).mockReturnValueOnce(true).mockReturnValueOnce(false)
    vi.spyOn(mockApi, 'findAssetInfo').mockReturnValue({
      location: v5Location,
      decimals: 18
    } as TAssetInfo)
    vi.mocked(createAsset).mockImplementation((ver, amount, location) => ({
      id: ver === Version.V3 ? { Concrete: location } : location,
      fun: { Fungible: amount }
    }))

    const options = {
      ...defaultOptions,
      from: 'Astar',
      to: 'Pendulum',
      version: Version.V3,
      currency: [
        { symbol: 'ASTR', amount: 1000n },
        { symbol: 'GLMR', amount: 2000n }
      ],
      feeAsset: { symbol: 'ASTR' }
    } as TSubstrateTransferOptions<unknown, unknown, unknown>

    const result = resolveOverriddenAsset(options, false, false, { symbol: 'ASTR' } as TAssetInfo)

    expect(pickCompatibleXcmVersion).toHaveBeenCalledWith(mockApi, 'Astar', 'Pendulum', Version.V3)
    expect(normalizeLocation).toHaveBeenCalledWith(v5Location, Version.V3)
    expect(createAsset).toHaveBeenCalledWith(Version.V3, 1000n, v3NormalizedLocation)
    expect(result?.[0]).toEqual({
      isFeeAsset: true,
      id: { Concrete: v3NormalizedLocation },
      fun: { Fungible: 1000n }
    })
  })

  it('throws an InvalidCurrencyError if a currency array is provided without a fee asset', () => {
    const options = {
      ...defaultOptions,
      currency: [{}, {}]
    } as TSubstrateTransferOptions<unknown, unknown, unknown>

    expect(() => resolveOverriddenAsset(options, false, false, {} as TAssetInfo)).toThrow(
      'Overridden assets cannot be used without specifying fee asset'
    )
  })

  it('returns undefined if currency is not an array', () => {
    const options = {
      ...defaultOptions,
      currency: { symbol: 'NO_OVERRIDE' }
    } as TSubstrateTransferOptions<unknown, unknown, unknown>

    const result = resolveOverriddenAsset(options, false, false, {} as TAssetInfo)
    expect(result).toBeUndefined()
  })
})
