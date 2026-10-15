# SAKU

UNIPDU's internal finance and payroll system: employee pay, attendance, activity reports and work-unit finances.

## Language

### Units and people

**SatKer**:
A university work unit (satuan kerja) with its own head and its own event budgets.
_Avoid_: department, unit kerja

**Sopir**:
A Pekarya employee who drives the university's vehicles and is paid per Perjalanan.
_Avoid_: driver (in user-facing text)

### Journeys and their cost

**Perjalanan**:
One continuous assignment of one vehicle and its Sopir, from the first departure to the last arrival back. The Sopir waits in between, so going out and back twice in a day is still one Perjalanan.
_Avoid_: trip, rit, journey leg

**Durasi tempuh**:
The total driving time of a Perjalanan's route as measured by Google Maps, excluding any time spent waiting.
_Avoid_: travel time, waktu perjalanan

**Durasi perjalanan**:
The clock time from a Perjalanan's first departure to its last arrival, waiting included.
_Avoid_: elapsed time, durasi PP

**Upah Bersih**:
The Sopir's pay for one Perjalanan: a distance component, a Durasi tempuh component, the meal allowance earned over the Durasi perjalanan, and the night premium for each night away.
_Avoid_: SPJ pay, fee, driver wage

**SPJ**:
The monthly settlement that collects a Sopir's approved Upah Bersih onto their pay slip.
_Avoid_: using "SPJ" for a single Perjalanan's pay

**Biaya BBM**:
The fuel cost of a Perjalanan: the distance of its whole loop from UNIPDU and back, times the vehicle's fixed rate per km.
_Avoid_: fuel allowance, jatah BBM (that is the cash advance, not the cost)

**Jatah BBM**:
The fuel cash advanced to the Sopir when a Perjalanan is authorized, later settled against the fuel receipts.
_Avoid_: Biaya BBM, fuel budget

**Tol & parkir**:
The toll and parking cost of a Perjalanan.

**Simulasi Biaya Perjalanan**:
A Kepala SatKer Loyalis's saved cost estimate for an event's planned Perjalanan (one or more, each starting and ending at UNIPDU Jombang): Biaya BBM + Tol & parkir + Upah Bersih for each, figured by the same rules that pay the real Perjalanan, plus a grand total. It books nothing.
_Avoid_: estimasi, kalkulator ongkos, perkiraan biaya
