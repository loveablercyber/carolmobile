import test from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzeLegacyDataset,
  deterministicLegacyUuid,
  mapLegacyAppointmentStatus,
  planLegacyPayment,
} from '../server/lib/legacy-import.js'

test('legacy UUIDs are stable and namespaced', () => {
  const first = deterministicLegacyUuid('profile', 'old-user-1')
  assert.equal(first, deterministicLegacyUuid('profile', 'old-user-1'))
  assert.notEqual(first, deterministicLegacyUuid('appointment', 'old-user-1'))
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
})

test('analyzes the source without mutating it', () => {
  const source = {
    data: {
      users: [{ role: 'customer' }, { role: 'admin' }],
      customerAppointments: [
        { service_name: 'Avaliação', payment_status: 'PENDING', total_price: '100' },
        { service_name: 'Avaliação', payment_status: 'NOT_REQUIRED', total_price: '0' },
      ],
      products: [{ id: 'p1' }],
      coupons: [],
    },
  }
  assert.deepEqual(analyzeLegacyDataset(source), {
    collections: { users: 2, customerAppointments: 2, products: 1, coupons: 0 },
    totalRecords: 5,
    users: 2,
    customers: 1,
    appointments: 2,
    distinctServices: 1,
    payments: 1,
    products: 1,
    coupons: 0,
  })
})

test('maps appointment and payment states conservatively', () => {
  assert.equal(mapLegacyAppointmentStatus('scheduled'), 'confirmed')
  assert.equal(mapLegacyAppointmentStatus('cancelled'), 'cancelled')
  assert.equal(mapLegacyAppointmentStatus('unknown'), 'requested')
  assert.deepEqual(
    planLegacyPayment({ payment_status: 'PENDING', total_price: '420', paid_amount: '80' }),
    { amount: 420, paidAmount: 80, status: 'partial', providerStatus: 'PENDING' },
  )
  assert.equal(
    planLegacyPayment({ payment_status: 'NOT_REQUIRED', total_price: '420', paid_amount: '0' }),
    null,
  )
})
