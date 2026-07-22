# Logic and Scheduling System for Satpam Pekarya

This document details the scheduling, post assignment, and payroll logic for the **Satpam Pekarya** (Security Guards) at Unipdu.

---

## 1. Team Structure

- **Total Satpam Pekarya**: 31 people.
  - **1 Ketua Satpam**: Ignored for the current implementation (administrative role).
  - **30 Satpam**: Divided into **3 groups of 10**.
- Each of the 3 groups has a designated **Ketua Shift** who leads the team for that shift.

### Group Roster
Based on organizational data:
1. **Group 1 (Ketua: BASTOMI)**
   - Members: SLAMET, SLAMET RIADI, SLAMET RAHARJO, BAMBANG HARIYONO, MATRAJI, MUHAMAD FUADY, SOEHARTO, ANDIK PRIYO UTOMO, SAMSUN.
2. **Group 2 (Ketua: MUJIONO)**
   - Members: ABIN MUSTOFA, MARIANTO, POEDJI UTOMO, SAMSUL HADI, ALIMIN, AMIR, MAKHIN, SLAMET GANGSAR, NANANG ABDUL AJIS.
3. **Group 3 (Ketua: SUHARIONO)**
   - Members: DIDIK SISWANTO, RUSMANTO, FATHONI, WAWAN WIRAWAN, IRIANTO, DODIK SUHANDOKO, SUGENG PRAYITNO SATPAM, SUBACHIN, MOH SAMSUL HIDAYAT.

---

## 2. Shift Schedules & Rotation

There are 3 fixed shift schedules:
1. **Shift Pagi**: 08:00 – 14:00 (6 hours)
2. **Shift Sore**: 14:00 – 22:00 (8 hours)
3. **Shift Malam**: 22:00 – 08:00 the next day (10 hours)

### Rotation Rules
- The groups rotate their shift schedule **every week** on Monday at 08:00 (start of Shift Pagi).
- Rotation sequence for a team: **Pagi $\rightarrow$ Malam $\rightarrow$ Sore $\rightarrow$ Pagi**.
- **Reference Start (Week 0)** (Monday, July 13, 2026 at 08:00 to Monday, July 20, 2026 at 08:00):
  - Team 1 (Bastomi) = **Shift Pagi**
  - Team 2 (Mujiono) = **Shift Malam**
  - Team 3 (Suhariono) = **Shift Sore**

---

## 3. Posts and Duty Assignment

There are **9 posts** to guard:
1. Pos 1: Pos IC
2. Pos 2: Pos Stasiun
3. Pos 3: Pos ATM Graha
4. Pos 4: Pos Plaza
5. Pos 5: Pos Masjid Induk
6. Pos 6: Pos Gor
7. Pos 7: Pos Saintek
8. Pos 8: Pos Parkiran FIK
9. Pos 9: Pos Hurun-inn

### Daily Duty Assignments
- In each shift group, there are **10 satpam**.
- **9 posts** need to be guarded.
- The **Ketua Shift** has two responsibilities:
  1. Perform mobile checks on all posts to verify members are doing their jobs.
  2. Guard **1 of the posts** (leaving 8 posts to be guarded by the remaining 9 members).
- Consequently, exactly **1 satpam will be off-duty** (on rest/libur) each day.

---

## 4. Shift Types and Pay Rates

Each reported shift falls into one of four categories, which determine its payout value (multipliers):

| Shift Type | Description | Rate |
| :--- | :--- | :--- |
| **Harian** | A regular shift schedule | **Rp 12,500** |
| **Jumat & Libur** | A regular shift performed on a Friday or national holiday | **Rp 25,000** |
| **Lembur Sendiri** | Working a shift voluntarily on one's designated off-duty day | **Rp 30,000** |
| **Lembur Cover** | Asked to cover another guard's shift (outside their regular roster) | **Rp 50,000** |
