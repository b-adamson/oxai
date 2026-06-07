#!/usr/bin/env python3
"""Repair extraction corruption in questions_2022.json (issue #8).

The 2022 extraction shifted option labels: each affected question's real
first option was dropped or glued onto the stem, every option shifted up one
label, and the last slot was filled with neighbouring-question text or a stray
page number — so the official answer key pointed at the wrong option.

This restores the exact stems and option lists (transcribed from the rendered
data/raw/2022.pdf) for the affected questions, and sets each answer label from
the official key. question_id, content tags, source, and figures are left
untouched.

NOTE: this covers the first batch of repaired questions only. ~34 more 2022
questions are still corrupted (tracked in issue #8); check_bank_integrity.py
flags them. Idempotent: rewrites the listed questions to their corrected form.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / 'data' / 'processed' / 'questions_2022.json'


def opts(*texts: str) -> List[Dict[str, str]]:
    labels = 'ABCDEFGH'
    return [{'label': labels[i], 'text': t} for i, t in enumerate(texts)]


# Per question: corrected stem + full corrected option list (from the PDF).
REPAIRS: Dict[str, Dict[str, Any]] = {
    '2022_B_21': {
        'stem': (
            'There is a constant current in a conducting wire. A charge of 20 C passes through '
            'the wire in 1.5 minutes.\n\n'
            'An 18 cm straight section of this wire lies in a uniform magnetic field. This section '
            'of wire is perpendicular to the direction of the field. The magnetic field strength '
            'is 0.15 T.\n\n'
            'What is the magnitude of the magnetic force on this section of wire?'
        ),
        'options': opts('0.0060 N', '0.36 N', '0.60 N', '0.81 N', '36 N', '49 N', '81 N', '4900 N'),
    },
    '2022_B_24': {
        'stem': (
            'Two identical resistors are connected in parallel to a 6.0 V battery. The two '
            'resistors dissipate a total power of 0.15 W.\n\n'
            'One of these resistors is removed from the circuit and connected to a 12 V battery.\n\n'
            'How much charge passes through this resistor in 6.0 minutes?'
        ),
        'options': opts('0.025 C', '0.050 C', '0.15 C', '0.30 C', '0.75 C', '1.5 C', '9.0 C', '18 C'),
    },
    '2022_B_26': {
        'stem': (
            'A block of mass 6.0 kg is pushed along a rough horizontal surface by a constant force '
            'of 8.0 N. The block accelerates uniformly from rest. After 4.0 s its velocity is '
            '2.0 m s$^{-1}$.\n\n'
            'How much work is done against resistive forces during this 4.0 s?'
        ),
        'options': opts('12 J', '20 J', '24 J', '32 J', '40 J', '64 J'),
    },
    '2022_B_34': {
        'stem': (
            'Radioactive isotope X undergoes a single beta ($\\beta^-$) decay to form the stable '
            'isotope Y.\n\n'
            'A sample consists only of X and Y. The graph shows how the mass of Y present in the '
            'sample varies with time. After a long time, the mass of Y in the sample becomes a '
            'constant 50 g.\n\n'
            'What is the half-life of X?'
        ),
        'options': opts('0.6 minutes', '1.2 minutes', '2.0 minutes', '3.2 minutes', '4.0 minutes', '5.2 minutes'),
    },
    '2022_B_38': {
        'stem': (
            'A tall, smooth cylinder contains air at atmospheric pressure of $1.00 \\times 10^5$ Pa. '
            'The density of the air in the cylinder is 1.20 kg m$^{-3}$.\n\n'
            'A heavy piston is now placed in the top of the cylinder and allowed to fall slowly '
            'downwards, compressing the air until the piston rests in equilibrium.\n\n'
            'The mass of the piston is 50.0 kg and its cross-sectional area is 0.0200 m$^2$.\n\n'
            'What is the density of the air in the cylinder when the piston rests in equilibrium?\n\n'
            '(gravitational field strength = 10 N kg$^{-1}$; assume that the air behaves as an ideal '
            'gas and that the temperature remains constant)'
        ),
        'options': opts('0.960 kg m$^{-3}$', '1.20 kg m$^{-3}$', '1.25 kg m$^{-3}$', '1.28 kg m$^{-3}$', '1.50 kg m$^{-3}$', '4.80 kg m$^{-3}$'),
    },
    '2022_B_39': {
        'stem': (
            'There are two types of earthquake waves, called P-waves and S-waves.\n\n'
            'When an earthquake occurs, both types of wave are produced at the same time and follow '
            'the same path.\n\n'
            'The P-waves travel outwards from the source at 5.0 km s$^{-1}$ and the S-waves travel '
            'out at 3.0 km s$^{-1}$.\n\n'
            'A seismic monitoring station detects the P-waves 30 s before the S-waves.\n\n'
            'How far have the waves travelled from the source of the earthquake to reach the '
            'seismic monitoring station?'
        ),
        'options': opts('60 km', '90 km', '135 km', '150 km', '225 km'),
    },
    '2022_C_41': {
        'stem': (
            'The following pairs of 0.1 mol dm$^{-3}$ solutions are mixed separately in test tubes.\n\n'
            '1 AgNO$_3$(aq) with NaI(aq)\n'
            '2 Cl$_2$(aq) with NaI(aq)\n'
            '3 HCl(aq) with NaOH(aq)\n'
            '4 MgCl$_2$(aq) with NaBr(aq)\n\n'
            'Which pair(s) of solutions, when mixed, would produce a visible chemical change?'
        ),
        'options': opts('1 only', '2 only', '3 only', '4 only', '1 and 2 only', '1 and 3 only', '2 and 4 only', '3 and 4 only'),
    },
    '2022_C_44': {
        'stem': (
            'Which of the following statements about losing electrons is/are correct?\n\n'
            '1 During the electrolysis of a molten binary compound the ions attracted to the cathode '
            '(negative electrode) lose electrons at that electrode.\n'
            '2 Descending Group 1 of the Periodic Table from lithium to caesium, the atoms of the '
            'elements lose electrons more easily.\n'
            '3 When a substance is acting as a reducing agent it loses electrons.'
        ),
        'options': opts('none of them', '1 only', '2 only', '3 only', '1 and 2 only', '1 and 3 only', '2 and 3 only', '1, 2 and 3'),
    },
    '2022_C_47': {
        'stem': (
            'Concentrated aqueous solutions of three compounds are electrolysed with inert '
            'electrodes.\n\n'
            'The constituent elements of which of the following compounds may be collected using '
            'this process?\n\n'
            '1 copper(II) bromide\n'
            '2 hydrogen chloride\n'
            '3 potassium chloride'
        ),
        'options': opts('none of them', '1 only', '2 only', '3 only', '1 and 2 only', '1 and 3 only', '2 and 3 only', '1, 2 and 3'),
    },
    '2022_C_51': {
        'stem': (
            'Three mixtures (P, Q and R) of amino acids were separated using paper chromatography.\n\n'
            'The test was repeated with the same mixtures, paper and solvent but this time the '
            'distance travelled by the common component of the mixtures was 7.5 cm.\n\n'
            'How far did the most mobile component of mixture Q travel in the second test?'
        ),
        'options': opts('6.0 cm', '8.5 cm', '9.0 cm', '9.6 cm', '10.5 cm', '12.0 cm'),
    },
    '2022_C_52': {
        'stem': (
            'A typical sample of dry air is at room temperature and pressure. There is a total of '
            '25.0 mol of gas in this sample.\n\n'
            'One of the gases in the sample, X, contributes $1.50 \\times 10^{23}$ separate particles '
            'to the mixture.\n\n'
            'A second gas in the sample, Y, would, if alone, occupy a volume of 468 dm$^3$ at room '
            'temperature and pressure.\n\n'
            'What are the identities of gases X and Y, and what would be the total amount of all of '
            'the remaining gases in the sample?\n\n'
            '(Take Avogadro’s number as $6.00 \\times 10^{23}$. Assume that one mole of any gas '
            'occupies a volume of 24.0 dm$^3$ at room temperature and pressure.)'
        ),
        'options': opts(
            'X = Ar, Y = N$_2$, total = 5.250 mol',
            'X = O$_2$, Y = N$_2$, total = 5.250 mol',
            'X = O$_2$, Y = Ar, total = 5.250 mol',
            'X = Ar, Y = O$_2$, total = 5.375 mol',
            'X = Ar, Y = N$_2$, total = 5.375 mol',
            'X = O$_2$, Y = N$_2$, total = 5.375 mol',
        ),
    },
    '2022_C_53': {
        'stem': (
            'The atomic number of fluorine is 9.\n\n'
            'An element X forms a fluoride with the formula XF$_3$. Each molecule of XF$_3$ has 32 '
            'electrons in total.\n\n'
            'Element X has two isotopes. One isotope has the same number of neutrons as protons and '
            'the other isotope has a number of neutrons one greater than the number of protons.\n\n'
            'The relative abundance of the heavier isotope is 0.80 (80%).\n\n'
            'What is the relative atomic mass of element X?'
        ),
        'options': opts('5.2', '5.8', '10.2', '10.8', '14.2', '14.8', '16.2', '16.8'),
    },
    '2022_C_54': {
        'stem': (
            '1 mol of compound X undergoes complete combustion to produce 144 dm$^3$ of carbon '
            'dioxide (measured at room temperature and pressure).\n\n'
            '1 mol of X can also undergo an addition reaction with 1 mol of hydrogen to form a '
            'saturated compound that has one branch.\n\n'
            'X undergoes addition polymerisation. A section of the addition polymer containing three '
            'repeating units has an $M_r$ value greater than 200 but less than 300.\n\n'
            'Which one of the following structural formulae could be that of compound X?\n\n'
            '($A_r$ values: C = 12; H = 1; F = 19. Assume that one mole of any gas occupies a volume '
            'of 24 dm$^3$ at room temperature and pressure.)'
        ),
        # Option structural formulae are images not extracted from the PDF.
        'options': opts(
            'structural formula A (see original paper)',
            'structural formula B (see original paper)',
            'structural formula C (see original paper)',
            'structural formula D (see original paper)',
            'structural formula E (see original paper)',
        ),
        'data_quality_note': 'Option structural-formula diagrams were not extracted; option text is a placeholder. Answer label is correct per the official key.',
    },
    '2022_C_55': {
        'stem': (
            'The equation shows the complete combustion of an alkane.\n\n'
            'alkane $+\\ a$O$_2 \\rightarrow b$CO$_2 + c$H$_2$O\n\n'
            '100 cm$^3$ of a gaseous alkane requires 650 cm$^3$ of oxygen for complete combustion. '
            'The volumes of both gases were measured at the same temperature and pressure.\n\n'
            'What is the value of $a + b + c$?'
        ),
        'options': opts('10.5', '12', '14', '15.5', '17.5', '19'),
    },
    '2022_C_56': {
        'stem': (
            'A sample of magnesium carbonate, MgCO$_3$, was reacted completely with 50 cm$^3$ of '
            '0.10 mol dm$^{-3}$ hydrochloric acid, which is an excess.\n\n'
            'The remaining hydrochloric acid was titrated with 0.20 mol dm$^{-3}$ sodium hydroxide '
            'solution. 5.0 cm$^3$ of sodium hydroxide was required for complete neutralisation.\n\n'
            'What was the original mass of magnesium carbonate used, in mg?\n\n'
            '($M_r$ value: MgCO$_3$ = 84)'
        ),
        'options': opts('42 mg', '84 mg', '168 mg', '210 mg', '336 mg', '420 mg'),
    },
    '2022_C_58': {
        'stem': (
            'An oxide of nitrogen can be prepared by the reaction of copper with hot nitric acid.\n\n'
            'The other products of the reaction are copper(II) nitrate and water.\n\n'
            '0.060 mol of copper reacted exactly with 40.0 cm$^3$ of 4.00 mol dm$^{-3}$ nitric acid.\n\n'
            'What is the empirical formula of the oxide of nitrogen produced in the reaction?'
        ),
        'options': opts('NO', 'NO$_2$', 'NO$_3$', 'N$_2$O', 'N$_2$O$_3$', 'N$_2$O$_5$'),
    },
    '2022_D_61': {
        'stem': (
            'Which of the following statements about breathing in is/are correct?\n\n'
            '1 The ribcage moves up and out because air enters the lungs.\n'
            '2 The volume of the thorax decreases and the thoracic pressure increases.\n'
            '3 Energy is required to contract the intercostal muscles but not the diaphragm.'
        ),
        'options': opts('none of them', '1 only', '2 only', '3 only', '1 and 2 only', '1 and 3 only', '2 and 3 only', '1, 2 and 3'),
    },
    '2022_D_64': {
        'stem': 'Which one of the following comparisons is correct?',
        'options': opts(
            'alveoli, bronchi — both are tissues that are specialised for gas exchange',
            'pancreas, ovary — both are organs that function as endocrine glands',
            'phloem, xylem — both are organs that transport liquids from leaves to roots in plants',
            'sensory neurone, motor neurone — both are tissues that are stimulated by a relay neurone',
            'small intestine, trachea — both are organs that have tissues with cilia',
        ),
    },
    '2022_D_66': {
        'stem': (
            'When a person touches a hot object, they rapidly pull their hand away as a result of a '
            'reflex arc.\n\n'
            'The diagram shows a student’s drawing of part of this reflex arc.\n\n'
            'Which label (A-E) is correct?'
        ),
        'options': opts(
            'motor neurone',
            'electrical impulse jumps across the gap between the two neurones',
            'sensory neurone',
            'hormone',
            'chemical receptors present on the membrane',
        ),
    },
    '2022_D_69': {
        'stem': (
            'The graph shows how the number of live bacteria in a population changes over time.\n\n'
            'Which statement is correct?'
        ),
        'options': opts(
            'If there were no limiting factors, the number of live bacteria in the population would be directly proportional to time.',
            'At 40 hours, there are on average 4.6 live bacteria per mm$^3$.',
            'At 60 hours, the number of bacteria dying is greater than the number being produced.',
            'Some of the live bacteria in the population at 60 hours could be genetically different to the bacteria in the population at 5 hours.',
            'There is no limiting factor affecting the population of live bacteria over the 60 hour period.',
        ),
    },
    '2022_D_72': {
        'stem': (
            'The diagram shows how blood glucose concentration is controlled.\n\n'
            'Which row is correct?'
        ),
        'options': opts(
            'pancreas — adrenaline — insulin — nervous response — nervous response',
            'pancreas — glucagon — insulin — negative feedback — negative feedback',
            'pancreas — insulin — glucagon — negative feedback — negative feedback',
            'pancreas — insulin — glucagon — nervous response — negative feedback',
            'pituitary — adrenaline — ADH — negative feedback — nervous response',
            'pituitary — ADH — glucagon — nervous response — negative feedback',
            'pituitary — ADH — insulin — nervous response — nervous response',
            'pituitary — glucagon — insulin — negative feedback — nervous response',
        ),
    },
}


# Official answer key (from append_answers.ANSWER_KEY_TEXT) for the repaired
# questions. Set directly here so the repair touches only these questions
# rather than re-stamping all 80 (which would mislabel the still-corrupted ones).
ANSWERS: Dict[str, str] = {
    '2022_B_21': 'A', '2022_B_24': 'G', '2022_B_26': 'B', '2022_B_34': 'C',
    '2022_B_38': 'E', '2022_B_39': 'E', '2022_C_41': 'E', '2022_C_44': 'G',
    '2022_C_47': 'E', '2022_C_51': 'C', '2022_C_52': 'A', '2022_C_53': 'D',
    '2022_C_54': 'E', '2022_C_55': 'D', '2022_C_56': 'C', '2022_C_58': 'A',
    '2022_D_61': 'A', '2022_D_64': 'B', '2022_D_66': 'E', '2022_D_69': 'D',
    '2022_D_72': 'B',
}


def main() -> None:
    data = json.loads(TARGET.read_text(encoding='utf-8'))
    by_id = {q['question_id']: q for q in data['questions']}

    missing = [qid for qid in REPAIRS if qid not in by_id]
    if missing:
        raise SystemExit(f'Question ids not found: {missing}')
    if set(REPAIRS) != set(ANSWERS):
        raise SystemExit('REPAIRS and ANSWERS keys differ')

    for qid, fix in REPAIRS.items():
        q = by_id[qid]
        q['prompt']['stem'] = fix['stem']
        q['prompt']['options'] = fix['options']

        label = ANSWERS[qid]
        text = next((o['text'] for o in fix['options'] if o['label'] == label), None)
        if text is None:
            raise SystemExit(f'{qid}: answer label {label} not in options')
        q['validation']['answer_label'] = label
        q['validation']['answer_text'] = text
        q['validation']['status'] = 'verified'

        if 'data_quality_note' in fix:
            notes = q.setdefault('data_quality_notes', [])
            if fix['data_quality_note'] not in notes:
                notes.append(fix['data_quality_note'])

    TARGET.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Repaired {len(REPAIRS)} questions in {TARGET.name}')


if __name__ == '__main__':
    main()
