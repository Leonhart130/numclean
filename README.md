# NumClean – Nettoyeur de numéros (extension Chrome)

Nettoie automatiquement les numéros au copier-coller : espaces (y compris insécables et fines),
points, tirets de toutes sortes, underscores, caractères invisibles. Pour les téléphones, aussi
les slashs et les parenthèses.

| Copié / collé            | Résultat       |
|--------------------------|----------------|
| `04.01.02.03.04`         | `0401020304`   |
| `04-01-02-03-04`         | `0401020304`   |
| `+33 (0)4 01 02 03 04`   | `0401020304`   |
| `+33 04 01 02 03 04`     | `0401020304`   |
| `2661502 004`            | `2661502004`   |
| `2661502-004`            | `2661502004`   |
| `2648807 02C`            | `264880702C`   |
| `2648807 C02`            | `2648807C02`   |

## Installation

1. Dézippe l'archive.
2. Ouvre `chrome://extensions`.
3. Active le **Mode développeur** (en haut à droite).
4. Clique sur **Charger l'extension non empaquetée** et choisis le dossier `numclean`.
5. Recharge (F5) les onglets déjà ouverts : l'extension ne s'applique qu'aux pages chargées après l'installation.

Épingle l'icône (puzzle → punaise) pour accéder aux réglages.

### Mise à jour

Remplace le dossier par la nouvelle version, clique sur la flèche de rechargement de NumClean
dans `chrome://extensions`, puis **recharge les onglets ouverts**.

## Fonctionnement

- **Ctrl+C / Ctrl+X** sur une page web : si la sélection est un numéro (ou une colonne / un tableau
  de numéros), le presse-papiers reçoit la version propre. Marche aussi pour coller ensuite hors
  du navigateur (Excel, logiciel métier…). Copier depuis un champ en lecture seule fonctionne.
- **Ctrl+V** dans un champ d'une page web : un numéro copié ailleurs (PDF, Excel, Outlook…) est
  collé propre.
- **Nettoyage à la main** : clic sur l'icône, colle le numéro dans « Tester ou nettoyer à la main »,
  puis **Copier le résultat**. Pratique pour un numéro copié dans un PDF et à coller dans Excel.
- Un petit message de confirmation s'affiche en bas à droite (désactivable).

## Copier depuis un PDF

Le lecteur PDF intégré de Chrome n'accepte aucune extension : un Ctrl+C dans un PDF n'est donc
**pas** nettoyé. Le numéro est nettoyé au moment où tu le colles dans une page web (Ctrl+V), ou
avec le bouton **Copier le résultat** de la fenêtre de l'extension. Un numéro coupé par un retour à
la ligne dans le PDF (`04 01` / `02 03 04`) est recollé s'il forme un vrai numéro de téléphone.

## Réglages (clic sur l'icône)

Interrupteur général, copier / coller, téléphones, conversion `+33` → `0`, numéros de compte,
téléphones au milieu d'un texte (désactivé par défaut), confirmation, exclusion du site courant,
et la zone de test / nettoyage à la main.

## Ce qui n'est pas touché

- Texte ordinaire (sauf option « téléphones au milieu d'un texte »), et copies mêlant texte et
  tableau (la mise en forme est conservée).
- Dates et périodes : `14/10/2026`, `14.10.2026`, `14 10 2026`, `2026-10-14`, `10/2026`,
  `2025-2026`, `01/09/2026 - 30/09/2026`…
- Adresses IP, montants (`1234.56`, `1 234,56`, `1 234.567`, `(1 234)`), nombres négatifs,
  coordonnées (`48.856614`), valeurs de moins de 6 chiffres.
- Listes de numéros : `04 01 02 03 04 / 06 12 34 56 78` n'est pas fusionné.
- Unités et mots : `150 000 m2`, `2648807 PV`.

Pour un compte, les lettres sont acceptées seulement dans le dernier groupe (`02C`, `C02`).
Le seuil de 6 chiffres se règle avec `MIN_DIGITS` dans `cleaner.js`.

## Limites

- Copier dans un PDF ouvert dans Chrome, dans Excel, Outlook ou un logiciel installé : pas de
  nettoyage à la copie (voir ci-dessus), seulement au collage dans une page web.
- Certains sites (logiciels métier, tableaux, boutons « Copier ») remplissent le presse-papiers à
  leur façon : la copie n'y est pas toujours nettoyée, mais le collage dans une page web l'est.
- Les champs et éditeurs qui gèrent eux-mêmes le collage (masques de saisie, éditeurs de texte
  riche) gardent la main : le collage n'y est pas nettoyé.
- Ambiguïté : `12345.678` est traité comme un numéro de compte (`12345678`), pas comme un décimal.
- Chrome interdit les extensions sur ses pages internes (`chrome://…`) et sur le Chrome Web Store.
- Excel et Google Sheets suppriment le 0 de tête d'un nombre (`0401020304` → `401020304`) :
  mets la colonne au format **Texte** avant de coller.

## Fichiers

- `manifest.json` – déclaration de l'extension (Manifest V3)
- `cleaner.js` – règles de nettoyage (testables sans navigateur)
- `content.js` – interception copier / couper / coller dans les pages
- `popup.html`, `popup.js` – réglages et nettoyage à la main
