# EVACTIS 3DWORKFLOW — release notes / notes de version

[English](#english) · [Français](#français)

## English

### 1.5.0 — release candidate (not yet released)

| | |
| --- | --- |
| Version | Studio, Viewer and Site Server **1.5.0** (the first release; numbered 1.5.0 by Evactis for the additions made during testing of the 1.0.0 candidate) |
| Date, commit | Filled in at release (the signed kit's `README.txt` records the commit) |
| SBOM advisory check | Filled in at release (step 1) |
| Reference-PC measurements | Filled in at release (`docs/performance.md`) |

The first release. Everything runs on the client's own computers and network: no
cloud service, no account with Evactis, no internet connection, and nothing is ever sent
anywhere.

**3DWORKFLOW Studio** (Evactis staff)
- Import 360° panoramas (12K and beyond), 360° videos, floor plans, photos, sounds, PDFs,
  3D models (GLB) and Gaussian splats; everything is checked and prepared on the computer.
- Build the tour: scenes, links and information points, floors with scaled plans, link
  suggestions you accept one by one; undo/redo, automatic saving and local versions.
- Safety layer: equipment, primary and alternative evacuation routes, assembly points
  and postings, each confirmed by a named person; only confirmed items are shown and
  printed. Bilingual evacuation plans (letter, tabloid) with "You are here", and the
  equipment register (CSV, Excel, PDF).
- Live layers (smoke conditions), animated regions, spatial sound, albums and documents.
- Training modules (find an item, reach the nearest exit, hazard hunts, questions) with
  scoring, checklists, certificates, and SCORM 1.2/2004 export.
- Skins: the Evactis default or a client's colours and logo, checked for contrast at
  phone, tablet, desktop and kiosk sizes.
- Delivery in every form: per-facility installer, `.evx` file, portable folder,
  intranet, browser folder, single HTML file, SCORM; optional passphrase encryption;
  every file checked before it is shown.
- Works with the keyboard alone, including placing scenes, hotspots and equipment.
- Fits the window: resizable side panels, interface size (A− / A+), a slim project bar,
  and a full-screen button (or F11).
- Links are animated arrows on the floor, followed by a walk-through into the next
  scene; hotspot sizes for links, information and equipment, for the whole tour or one
  by one.

**Windows installation**
- One setup for Studio and/or the Viewer, for one person or everyone on the PC, with an
  illustrated installation guide (EN/FR); the separate installers and MSIs stay for IT.
- The embedded WebView2 installer is pinned, so the same release always builds the same
  setup.

**3DWORKFLOW Viewer**
- The facility in 360°, 3D and VR (where the device supports it), with the floor plan,
  "You are here", safety signs and the evacuation route from where you stand.
- Different layers for staff, contractors, leadership and first responders.
- English and French, keyboard and screen-reader friendly, reduced-motion aware.

**3DWORKFLOW Site Server** (optional, on the client's network only)
- Shared notes pinned in scenes, guided sessions with voice and video through the
  server's own relay, local usage reports (off by default), Active Directory sign-in.
- Runs as a standalone program (Windows, Linux) or a Docker image; on Windows it can
  start at boot on its own (`install-task`).

**Known limitations**
- Insta360 originals (`.insp`, `.insv`) must be exported as stitched images or videos
  first; direct import is planned.
- Floor plans are images (PNG, JPG, TIFF); export PDF or CAD plans to an image first.
- Packages are limited to 4 GB and 65,535 files.
- From a folder or single file opened in a browser, VR is not offered and videos load
  whole into memory; the single file keeps panoramas at 2048 px per face.
- Safety signs follow ISO 7010 conventions but are not certified artwork.
- The desktop Viewer does not connect to a Site Server; collaboration is in the browser.
- Certificates carry the name the learner types; they are not verifiable records.

## Français

### 1.5.0 — version candidate (pas encore publiée)

| | |
| --- | --- |
| Version | Studio, Viewer et Site Server **1.5.0** (première version publiée; numérotée 1.5.0 par Evactis pour les ajouts faits pendant les essais de la candidate 1.0.0) |
| Date, commit | À remplir à la publication (le `README.txt` de la trousse signée indique le commit) |
| Vérification des avis de sécurité (SBOM) | À remplir à la publication (étape 1) |
| Mesures sur les postes de référence | À remplir à la publication (`docs/performance.md`) |

Première version. Tout fonctionne sur les ordinateurs et le réseau du client : aucun
service infonuagique, aucun compte chez Evactis, aucune connexion Internet, et rien
n’est jamais transmis.

**3DWORKFLOW Studio** (personnel d’Evactis)
- Importation de panoramas 360° (12K et plus), de vidéos 360°, de plans d’étage, de
  photos, de sons, de PDF, de modèles 3D (GLB) et de splats gaussiens; tout est vérifié
  et préparé sur l’ordinateur.
- Construction de la visite : scènes, liens et points d’information, étages avec plans à
  l’échelle, liens suggérés que vous acceptez un à un; annuler/rétablir, enregistrement
  automatique et versions locales.
- Couche sécurité : équipement, itinéraires d’évacuation principal et de rechange,
  points de rassemblement et affichages, chacun confirmé par une personne nommée; seuls
  les éléments confirmés sont affichés et imprimés. Plans d’évacuation bilingues (lettre,
  tabloïd) avec « Vous êtes ici », et registre d’équipement (CSV, Excel, PDF).
- Couches en direct (conditions de fumée), zones animées, son spatial, albums et
  documents.
- Modules de formation (trouver un objet, atteindre la sortie la plus proche, chasse aux
  dangers, questions) avec pointage, listes de vérification, attestations et export
  SCORM 1.2/2004.
- Habillages : celui d’Evactis par défaut, ou les couleurs et le logo d’un client,
  vérifiés pour le contraste aux tailles téléphone, tablette, bureau et borne.
- Livraison sous toutes les formes : programme d’installation par établissement, fichier
  `.evx`, dossier portable, intranet, dossier navigateur, fichier HTML unique, SCORM;
  chiffrement facultatif par phrase de passe; chaque fichier vérifié avant d’être
  affiché.
- Utilisable entièrement au clavier, y compris pour placer scènes, points et équipement.
- S’adapte à la fenêtre : panneaux latéraux redimensionnables, taille de l’interface
  (A− / A+), barre de projet mince et bouton plein écran (ou F11).
- Les liens sont des flèches animées au sol, suivies d’une marche vers la scène
  suivante; taille des points d’intérêt pour les liens, l’information et l’équipement,
  pour toute la visite ou un par un.

**Installation sous Windows**
- Un seul programme d’installation pour Studio et/ou le Viewer, pour une personne ou
  pour tous les utilisateurs du PC, avec un guide d’installation illustré (EN/FR); les
  programmes séparés et les MSI restent pour l’informatique.
- Le programme d’installation WebView2 intégré est figé : une même version produit
  toujours le même programme d’installation.

**3DWORKFLOW Viewer**
- L’établissement en 360°, en 3D et en réalité virtuelle (si l’appareil le permet), avec
  le plan d’étage, « Vous êtes ici », les panneaux de sécurité et l’itinéraire
  d’évacuation à partir de l’endroit où vous êtes.
- Des couches différentes pour le personnel, les entrepreneurs, la direction et les
  premiers intervenants.
- Anglais et français, compatible clavier et lecteur d’écran, respecte la réduction des
  animations.

**3DWORKFLOW Site Server** (facultatif, sur le réseau du client seulement)
- Notes partagées épinglées dans les scènes, visites guidées avec voix et vidéo par le
  relais du serveur, rapports d’utilisation locaux (désactivés par défaut), connexion
  Active Directory.
- Programme autonome (Windows, Linux) ou image Docker; sous Windows, il peut démarrer
  seul avec l’ordinateur (`install-task`).

**Limites connues**
- Les originaux Insta360 (`.insp`, `.insv`) doivent d’abord être exportés en images ou
  vidéos assemblées; l’importation directe est prévue.
- Les plans d’étage sont des images (PNG, JPG, TIFF); exportez d’abord les plans PDF ou
  DAO en image.
- Les paquets sont limités à 4 Go et 65 535 fichiers.
- Depuis un dossier ou un fichier unique ouvert dans un navigateur, la réalité virtuelle
  n’est pas offerte et les vidéos sont chargées entièrement en mémoire; le fichier unique
  garde les panoramas à 2048 px par face.
- Les panneaux de sécurité suivent les conventions ISO 7010 mais ne sont pas des
  illustrations certifiées.
- Le Viewer de bureau ne se connecte pas à un Site Server; la collaboration se fait dans
  le navigateur.
- Les attestations portent le nom tapé par l’apprenant; ce ne sont pas des documents
  vérifiables.
