# Journey authorization uses the driver-report pay rules, from now on only

When Kepala SatKer Pekarya authorizes a Perjalanan, the Upah Bersih estimate and the Jatah BBM used to come from a shortcut: the one-way distance doubled, a single "Durasi PP" hours figure standing in for both Durasi tempuh and Durasi perjalanan, and no night premium. A Jombang → Surabaya day trip showed Rp83.000 while the Sopir was paid Rp103.000. We decided that authorization uses the same rules as the Sopir's own report: the whole loop from UNIPDU and back is measured by Google Directions, Durasi tempuh comes from that measurement, and the meal allowance and nights come from a planned departure and return date and time. This way the Simulasi Biaya Perjalanan, the authorization screen and the final pay show one figure.

The change applies only to Perjalanan authorized after it ships. Earlier Perjalanan keep the Jatah BBM and estimate they were authorized with, so the data holds both rules side by side.

## Considered Options

- **Recompute every open Perjalanan under the new rule**: rejected, because their Jatah BBM was already handed over or reserved in the vehicle fuel ledger, and changing it would unsettle cash that is already out.
- **Keep doubling the one-way distance for Jatah BBM and fix only the displayed estimate**: rejected, because on multi-stop trips the advance would then differ from the Biaya BBM the Simulasi shows for the same route.

## Consequences

Jatah BBM for a multi-stop Perjalanan is usually lower than before (UNIPDU → Surabaya → Sidoarjo with an Innova Matic: about Rp29.000 less). The Sopir's net pay barely changes, because leftover fuel cash is already deducted from Upah Bersih and overspending is already reimbursed.
