# QRShare — Guide utilisateur

## Qu'est-ce que QRShare ?

QRShare est une application web qui permet de :

1. **Scanner un QR code** avec la caméra de votre appareil
2. **Créer un QR code** à partir d'un texte ou d'une adresse web
3. **Partager un fichier ou du texte** vers n'importe quelle application via le dialogue de partage natif
4. **Envoyer un fichier ou du texte** à un autre appareil via des QR codes animés (sans connexion internet)
5. **Envoyer un fichier ou du texte** en pair-à-pair via WebRTC (avec connexion internet)
6. **Envoyer un texte court ou un petit fichier** sous forme de son, du haut-parleur au microphone (Audio — Expérimental, sans internet ni caméra)

L'application fonctionne directement dans votre navigateur, sans rien installer. Elle est accessible à l'adresse :
**https://s-celles.github.io/QRShare/**

```mermaid
flowchart TD
    Accueil[Page d'accueil]
    Accueil --> Scanner[Scanner un QR code]
    Accueil --> Creer[Créer un QR code]
    Accueil --> EnvPartage[Envoyer via Partage]
    Accueil --> EnvQR[Envoyer via QR]
    Accueil --> RecQR[Recevoir via QR]
    Accueil --> EnvWR[Envoyer via WebRTC]
    Accueil --> RecWR[Recevoir via WebRTC]

    Scanner --> |URL détectée| Lien[Ouvrir le lien]
    Scanner --> |Texte détecté| Copier[Copier / Partager / Envoyer]
    Creer --> Telecharger[Télécharger PNG]
    Creer --> Partager[Partager / Envoyer via QR / WebRTC]
    EnvPartage --> |Dialogue natif| Apps[Autres applications]
    EnvQR --> |QR codes animés| RecQR
    EnvWR --> |Pair-à-pair| RecWR
```

---

## Page d'accueil

En ouvrant l'application, vous voyez deux sections :

### Outils QR (en haut)

Deux boutons pour les outils QR du quotidien :

- **Scanner un QR code** — Pour lire un QR code avec votre caméra
- **Créer un QR code** — Pour fabriquer votre propre QR code

### Transfert de fichiers (en bas)

Cinq boutons pour le transfert de fichiers entre appareils :

- **Envoyer (Partage)** — Partager des fichiers via le dialogue de partage natif (messagerie, e-mail, stockage cloud, etc.)
- **Envoyer (QR)** — Envoyer un fichier via des QR codes animés
- **Recevoir (QR)** — Recevoir un fichier en scannant les QR codes animés
- **Recevoir (WebRTC)** — Recevoir un fichier en pair-à-pair sur le réseau
- **Envoyer (WebRTC)** — Envoyer un fichier en pair-à-pair sur le réseau

Deux groupes expérimentaux suivent le groupe QR Code : **CIMBAR (Expérimental)**,
un code-barres couleur à haut débit, et **Audio (Expérimental)**, qui transfère
de petits contenus sous forme de son (voir *Transfert audio expérimental*
plus bas).

---

## Scanner un QR code

1. Appuyez sur **Scanner un QR code**
2. Appuyez sur **Démarrer le scan** — votre navigateur vous demandera d'autoriser la caméra
3. Pointez la caméra vers un QR code
4. Le contenu s'affiche automatiquement :
   - Si c'est une adresse web, elle apparaît sous forme de lien cliquable
   - Sinon, le texte est affiché et vous pouvez le copier avec le bouton **Copier dans le presse-papiers**
5. Dès qu'un contenu est reçu, le scan s'arrête et la zone caméra disparaît

**Informations affichées pendant le scan** : nom de la caméra utilisée et résolution. Si vous avez plusieurs caméras, un menu déroulant permet de choisir laquelle utiliser.

---

## Créer un QR code

1. Appuyez sur **Créer un QR code**
2. Tapez votre texte ou collez une adresse web dans la zone de saisie
3. Le QR code se génère instantanément et se met à jour à chaque modification
4. Ajustez les paramètres si besoin :
   - **Modèle** — Choisissez entre **Texte brut**, **Réseau Wi-Fi** (`WIFI:S:...`) ou **Carte de contact** (**MECARD** compacte ou **vCard 3.0** standard).
   - **Correction d'erreur** — Niveau de correction d'erreur (L, M, Q ou H). Plus le niveau est élevé, plus le QR code résiste aux dégradations, mais moins il peut contenir de données.
   - **Version** — En mode Auto, l'application choisit la plus petite taille possible. En mode Manuel, vous choisissez une version de 1 (petit) à 40 (très grand).
5. Le compteur **Charge utile** indique combien d'octets votre texte occupe par rapport à la capacité maximale.
6. Pour un QR code Wi-Fi, vous pouvez cliquer sur **Imprimer la fiche Wi-Fi** pour afficher et imprimer une pancarte d'accès Wi-Fi propre et professionnelle.
7. Appuyez sur **Télécharger PNG** pour enregistrer le QR code comme image.

Si le texte est trop long pour la version et le niveau de correction choisis, un message d'erreur s'affiche.

### Découverte d'appareils sur le réseau local (Sans QR Code)

Sur l'écran d'accueil, QRShare affiche automatiquement la carte **"Appareils à proximité (Réseau local)"** dès que d'autres appareils connectés au même Wi-Fi/LAN ont QRShare ouvert :
- **Détection zéro scan** : Les appareils s'annoncent automatiquement via la signalisation WebRTC sans nécessiter de scanner de QR code.
- **Envoi direct** : Cliquez sur **Envoyer** à côté d'un appareil pour lui envoyer directement un fichier ou du texte.
- **Confirmation du receveur** : Le destinataire reçoit une boîte de dialogue d'invitation (*Accepter / Refuser*). Une fois acceptée, le transfert démarre immédiatement via DataChannel WebRTC local.
- **Paramètres de confidentialité** : Il est possible de désactiver la découverte locale ou de personnaliser le nom de son appareil dans les **Paramètres**.

---

## Préparer un transfert et inviter le receveur

Ce workflow permet au donneur de préparer le contenu et d'ouvrir QRShare sur le bon écran chez le receveur avant de transmettre les données.

1. Sur l'accueil, appuyez sur **Préparer un transfert**.
2. Choisissez **Fichier** ou **Texte**, puis sélectionnez un ou plusieurs fichiers ou saisissez le texte.
3. Choisissez la politique de transfert :
   - **Hors réseau uniquement** — seuls les modes hors réseau (QR statique, QR animé, CIMBAR expérimental ou audio expérimental) sont proposés. WebRTC et le partage système sont exclus, quelle que soit la taille.
   - **Privilégier le hors réseau** — un mode optique est recommandé, mais les modes réseau restent disponibles.
   - **Tous les modes** — QRShare peut notamment recommander WebRTC lorsque le contenu ne tient pas dans un QR statique.
4. Vérifiez le mode recommandé ou choisissez un autre mode autorisé. La taille n'est qu'un des critères : la politique choisie est toujours respectée.
5. Montrez d'abord le QR code d'invitation au receveur. Ce QR contient uniquement un lien vers QRShare et ouvre directement l'écran de réception correspondant ; il ne contient pas le fichier.
6. Quand le receveur est prêt, appuyez sur **Le receveur est prêt — commencer l'envoi**.

Si plusieurs fichiers sont sélectionnés, QRShare les regroupe automatiquement dans une archive ZIP de transfert, puis les extrait chez le receveur. La sélection est limitée à 50 Mo au total ; CIMBAR est proposé jusqu'à environ 33 Mo et l'audio jusqu'à 8 Ko ; pour plusieurs fichiers, ces limites s'appliquent à la taille de l'archive ZIP. Si le contenu dépasse la limite du mode choisi, le mode revient au mode recommandé. L'audio n'est recommandé que si l'appareil n'a pas de caméra et que le contenu fait au plus 1 Ko.

### Transmettre du texte par une URL

Une application peut ouvrir directement le sélecteur d'envoi avec une URL de la forme :

```text
https://s-celles.github.io/QRShare/#/send?data=Bonjour&policy=prefer-airgap
```

`data` contient le texte encodé pour une URL. `policy` accepte `airgap`, `prefer-airgap` ou `any`. En l'absence d'une politique valide, QRShare privilégie le mode hors réseau. Cette méthode convient au texte ; les fichiers sont transmis comme décrit ci-dessous.

### Échanger des fichiers avec d'autres applications web

Des applications web comme [Progressive Web Office](https://github.com/s-celles/progressive-web-office) peuvent confier des fichiers à QRShare, et récupérer les fichiers reçus, directement dans le navigateur (protocole de transmission entre applications, version 1) :

- **Application → QRShare** : l'application ouvre `#/send?handoff=1&policy=...`. QRShare affiche *En attente du fichier de l'application…*, reçoit le fichier puis ouvre le sélecteur de transfert avec *Reçu de <application>*. Rien n'est envoyé tant que vous n'avez pas choisi un mode de transfert.
- **QRShare → Application** : l'application ouvre l'écran de réception avec un paramètre `return`, par exemple `#/receive/qr?policy=airgap&return=https%3A%2F%2Fexample.org%2Fapp%2F`. Une fois le fichier reçu, le bouton **Ouvrir dans <hôte>** le transmet à cette application uniquement.

Les fichiers partagés vers QRShare depuis la feuille de partage du système s'ouvrent également dans le sélecteur de transfert.

Pour les développeurs : les deux fenêtres échangent des messages `{ type: "qrshare-handoff", version: 1, action }` avec `postMessage` — `ready` (fenêtre qui reçoit → sa fenêtre d'origine), `file` (`name`, `mimeType`, `data` sous forme d'`ArrayBuffer`, envoyé à l'origine exacte) et `received`. Les fichiers sont limités à 200 Mo. Les applications peuvent vérifier la prise en charge au préalable : le `manifest.webmanifest` de QRShare liste les versions du protocole dans `qrshare_handoff.versions`.

---

## Partager des fichiers via le partage natif

Cette méthode utilise le dialogue de partage intégré à votre navigateur pour envoyer des fichiers vers n'importe quelle application compatible (messagerie, e-mail, stockage cloud, etc.).

1. Appuyez sur **Envoyer (Partage)**
2. Déposez des fichiers ou cliquez pour parcourir et sélectionner un ou plusieurs fichiers
3. Le dialogue de partage natif s'ouvre — choisissez l'application cible
4. Le fichier est transmis à l'application sélectionnée

**Remarque :** Cette fonctionnalité nécessite un navigateur compatible avec l'API Web Share (la plupart des navigateurs mobiles et certains navigateurs de bureau). Si non supportée, un message d'erreur s'affiche.

---

## Envoyer un fichier par QR code (sans internet)

Cette méthode ne nécessite **aucune connexion internet**. Le fichier est transmis optiquement, d'écran à caméra.

```mermaid
sequenceDiagram
    participant E as Émetteur
    participant R as Récepteur

    E->>E: Sélectionner le fichier
    E->>E: Compresser & encoder (codes fontaine)
    loop QR codes animés
        E->>R: Afficher le QR à l'écran
        R->>R: Scanner avec la caméra
    end
    R->>R: Décoder & décompresser
    R->>R: Télécharger le fichier
```

**Sur l'appareil qui envoie :**
1. Appuyez sur **Envoyer (QR)**
2. Déposez un fichier ou cliquez pour en choisir un (50 Mo maximum)
3. Choisissez un mode d'encodage :
   - **Haute vitesse** — QR codes plus grands, adapté aux bonnes conditions de scan
   - **Équilibré** — Compromis entre capacité et fiabilité
   - **Haute fiabilité** — QR codes plus petits, très fiable
4. Un QR code animé s'affiche à l'écran — ne fermez pas la page
5. Ajustez les paramètres de transfert si nécessaire :
   - **Fréquence d'images** (1–30 FPS, par défaut : 10) — Des valeurs plus basses donnent plus de temps à la caméra pour scanner chaque image
   - **Taille de bloc** (50–1000 octets, par défaut : 250) — Des blocs plus petits produisent des QR codes plus simples, plus faciles à scanner

**Sur l'appareil qui reçoit :**
1. Appuyez sur **Recevoir (QR)**
2. Appuyez sur **Démarrer le scan**
3. Pointez la caméra vers le QR code animé de l'appareil émetteur
4. La barre de progression montre l'avancement du transfert, ainsi que le débit et le temps écoulé
5. Une fois terminé, le fichier se télécharge automatiquement

---

## Envoyer un fichier par WebRTC (avec internet)

Cette méthode utilise une connexion réseau mais le fichier transite directement d'appareil à appareil, sans passer par un serveur.

La découverte de pair utilise plusieurs stratégies de signalisation en parallèle (relais Nostr, trackers BitTorrent, brokers MQTT) pour une meilleure fiabilité. La première stratégie à découvrir le pair l'emporte, les autres sont annulées.

```mermaid
sequenceDiagram
    participant E as Émetteur
    participant Sig as Signalisation (Nostr/Torrent/MQTT)
    participant R as Récepteur

    R->>Sig: Créer la salle (afficher QR + Room ID)
    E->>Sig: Rejoindre la salle (scanner QR ou saisir ID)
    Sig->>E: Découverte du pair (course parallèle)
    Sig->>R: Découverte du pair (course parallèle)
    E-->>R: Connexion WebRTC établie
    E->>R: Vérifier le code de confirmation
    E->>E: Sélectionner le(s) fichier(s)
    E->>R: Transfert du fichier (pair-à-pair)
    R->>R: Télécharger le fichier
```

**Sur l'appareil qui reçoit :**
1. Appuyez sur **Recevoir (WebRTC)**
2. Un QR code s'affiche avec un identifiant de salle (Room ID)

**Sur l'appareil qui envoie :**
1. Appuyez sur **Envoyer (WebRTC)**
2. Scannez le QR code du récepteur ou saisissez le Room ID manuellement
3. Vérifiez que le **code de confirmation à 4 chiffres** est identique sur les deux appareils
4. Sélectionnez le(s) fichier(s) à envoyer
5. Le transfert démarre automatiquement

---

## Barre de navigation

En haut de chaque page :

- **QRShare** (à gauche) — Retour à la page d'accueil. Le numéro de version et le hash de build sont affichés à côté du titre
- Bouton de thème — Passer de ◐ Auto (suit le réglage du système) à ☀ Clair puis ☾ Sombre
- **?** — Guide utilisateur
- **i** — Page « À propos »
- Roue dentée — Paramètres (langue, thème, paramètres WebRTC)
- **← Retour** — Retour à la page d'accueil (présent sur chaque sous-page)

---

## Paramètres WebRTC

Accès via **Paramètres → Paramètres WebRTC** (ou directement à `/#/settings/webrtc`).

### Mode de connexion

- **Parallèle** (par défaut) — Toutes les stratégies activées sont essayées simultanément. La première à établir une connexion gagne. C'est l'approche la plus rapide.
- **Séquentiel** — Les stratégies sont essayées une par une dans l'ordre configuré. En cas d'échec (timeout de 10 secondes), la suivante est essayée. Utile si vous souhaitez privilégier une stratégie spécifique.

### Stratégies de signalisation

QRShare utilise plusieurs stratégies de signalisation pour aider deux appareils à se trouver pour le transfert WebRTC :

| Stratégie | Protocole | Description |
|-----------|-----------|-------------|
| **nostr** | Relais Nostr | Réseau de relais décentralisé |
| **torrent** | Trackers BitTorrent | Protocole tracker WebTorrent |
| **mqtt** | Courtiers MQTT | Protocole de messagerie léger |

Pour chaque stratégie vous pouvez :

- **Activer/désactiver** via la case à cocher
- **Réordonner** avec les flèches haut/bas (l'ordre est important en mode séquentiel)
- **Modifier les URL des relais** (une par ligne) pour utiliser des serveurs personnalisés

Au moins une stratégie doit rester activée. Laissez les URL des relais vides pour utiliser les valeurs par défaut.

### Réinitialisation

Cliquez sur **Réinitialiser les valeurs par défaut** pour restaurer tous les paramètres WebRTC à leurs valeurs d'origine.

---

## Export / Import des paramètres

Vous pouvez sauvegarder et restaurer tous les paramètres de QRShare (thème, langue et configuration WebRTC) via des fichiers TOML.

### Export

1. Allez dans **Paramètres**
2. Cliquez sur **Exporter les paramètres (TOML)**
3. Un fichier `qrshare-config.toml` est téléchargé

### Import

1. Allez dans **Paramètres**
2. Cliquez sur **Importer les paramètres (TOML)**
3. Sélectionnez un fichier `.toml` précédemment exporté
4. Tous les paramètres sont appliqués immédiatement

Cela permet de partager votre configuration entre appareils ou de restaurer vos paramètres après avoir effacé les données du navigateur.

---

## Transfert CIMBAR expérimental

CIMBAR est un mode optique hors réseau à haut débit utilisant des matrices de
symboles colorés. Sélectionnez **Envoyer (CIMBAR — Expérimental)** sur le donneur
et **Recevoir (CIMBAR — Expérimental)** sur le receveur. Le workflow
**Préparer un transfert** peut également générer l'invitation correspondante et
précharger le fichier côté donneur.

Le décodeur navigateur libcimbar est encore en version bêta. Utilisez une bonne
luminosité, maximisez la matrice sur l'écran et conservez le mode QR animé
standard comme solution de repli. La limite du protocole CIMBAR est d'environ
33 Mo après compression. Dès que le résultat est reconstruit, la zone caméra
disparaît. Un fichier peut ensuite être téléchargé ou partagé avec le dialogue
système. Un message texte préparé dans QRShare est affiché directement avec les
mêmes actions que sur les autres récepteurs : copier, télécharger en `.txt` et
partager.

---

## Transfert audio expérimental

L'audio envoie un texte court ou un petit fichier **sous forme de son** : le
donneur joue des tonalités par son haut-parleur et le receveur les décode depuis
son microphone. Ni réseau, ni caméra, ni ligne de vue ne sont nécessaires, il
suffit que les deux appareils s'entendent. C'est utile quand les caméras sont
inutilisables (pas de caméra, objectif abîmé, écran impossible à montrer), pour
des mots de passe Wi-Fi, des clés, des notes courtes ou de petits fichiers de
configuration.

### Utilisation

1. Sur le receveur, touchez **Recevoir (Audio — Expérimental)**, puis
   **Commencer l'écoute**, et autorisez le microphone. Le receveur détecte
   automatiquement le profil du donneur.
2. Sur le donneur, touchez **Envoyer (Audio — Expérimental)**, choisissez
   **Fichier** ou **Texte**, puis appuyez sur **Lire**. L'audio peut aussi être
   choisi dans le sélecteur de transfert et dans **Préparer un transfert**, dont
   le QR code d'invitation ouvre l'écran de réception audio sur le receveur. Un
   lien avec `autostart=1` lance l'écoute immédiatement ; si le navigateur exige
   d'abord un appui, un grand bouton **Touchez pour commencer l'écoute**
   apparaît.
3. Le donneur joue des paquets en continu. Chaque paquet porte un morceau
   différent d'un code fontaine : les paquets manqués ou abîmés ne gênent pas,
   le receveur termine dès qu'il en a entendu assez. Appuyez sur **Arrêter** une
   fois que le receveur affiche le résultat. Si vous changez de profil ou de code
   sur le donneur pendant que le receveur écoute, le receveur suit
   automatiquement la nouvelle émission du même contenu.

Le receveur affiche le niveau d'entrée, un badge **Signal détecté**, les paquets
décodés et rejetés, les symboles uniques reçus par rapport aux symboles
nécessaires, et le débit effectif. À la fin du transfert, le microphone est
libéré et le résultat s'affiche comme pour les autres receveurs : vérification
SHA-256, texte affiché directement, ou fichier avec aperçu, **Télécharger**,
**Partager** et **Ouvrir dans …** ; un contenu chiffré par mot de passe affiche
la carte de déverrouillage.

### Profils et débits

| Profil | Bande | Débit net approx. | Quand l'utiliser |
|---|---|---|---|
| **Robuste** (par défaut) | 1,5–6,3 kHz, audible | environ 22 octets/s | Usage normal, téléphones et ordinateurs portables |
| **Rapide** | 1,5–6,3 kHz, audible | environ 53 octets/s | Pièce calme, appareils proches |
| **Ultrasonique** (Avancé, moins fiable) | 17–19,5 kHz, à peine audible | environ 10 octets/s | Quand les tonalités audibles posent problème ; beaucoup de haut-parleurs et de microphones l'atténuent |

Par exemple, un texte de 1 Ko compressé à environ 600 octets prend environ une
demi-minute avec Robuste et environ 13 secondes avec Rapide. Le donneur affiche
la durée minimale estimée avant d'appuyer sur Lire. Dans **Avancé**, le donneur
peut aussi choisir le code fontaine : **Automatique (Wirehair)**, par défaut et
le plus efficace, ou **LT (compatibilité)** si le receveur signale que Wirehair
ne peut pas être chargé.

### Limites de taille

L'audio convient aux contenus jusqu'à **1 Ko**. Jusqu'au maximum absolu de
**8 Ko**, il reste disponible mais lent (plusieurs minutes) ; au-delà de 8 Ko, le
donneur refuse et suggère les QR codes animés ou CIMBAR.

### Conseils

- Réglez le volume multimédia du donneur entre 70 et 100 %.
- Gardez les appareils à 10–50 cm l'un de l'autre dans une pièce calme.
- N'utilisez pas d'enceinte ni de casque Bluetooth (leurs codecs déforment les
  tonalités).
- Sur iPhone, QRShare demande au système de jouer le son même en mode
  silencieux, lorsque Safari le permet.
- Si le receveur affiche **Trop faible**, rapprochez-vous ou montez le volume ;
  s'il affiche **Saturation**, baissez le volume.

### Limitations et confidentialité

- C'est une diffusion à sens unique : le donneur ne sait pas quand le receveur a
  terminé.
- Certains navigateurs (notamment sur iOS) peuvent encore appliquer un
  traitement de la voix au microphone, ce qui réduit la fiabilité.
- Le son se diffuse : toute personne à portée d'oreille, ou tout appareil
  d'enregistrement, peut capter le transfert. Pour un contenu sensible, cochez
  **Chiffrer avec un mot de passe** sur le donneur audio et transmettez le mot
  de passe au receveur par un autre moyen ; le receveur le demandera pour
  déverrouiller le contenu. Le chiffrement ajoute 49 octets et les données
  chiffrées ne se compressent plus, le transfert est donc un peu plus long. Le microphone n'est utilisé que pendant l'écoute, et
  aucun son n'est enregistré.

---

## Partage de messages texte

Les trois méthodes de transfert (Partage, QR, WebRTC) prennent en charge l'envoi de messages texte en plus des fichiers. En entrant dans une vue d'envoi, un bouton **Fichier / Texte** en haut permet de choisir le type de contenu.

### Envoyer du texte

1. Sélectionnez un mode d'envoi (Partage, QR ou WebRTC)
2. Basculez le sélecteur de **Fichier** à **Texte**
3. Saisissez ou collez votre message dans la zone de texte (jusqu'à 100 000 caractères)
4. Le compteur de caractères s'affiche sous la zone de saisie
5. Appuyez sur le bouton d'envoi/partage

En mode QR, un texte court est encodé dans un seul QR code. Un texte plus long utilise le même pipeline de codes fontaine que les fichiers.

### Recevoir du texte

Lorsqu'un autre appareil envoie un message texte, le récepteur le détecte automatiquement et affiche le texte directement au lieu de déclencher un téléchargement. Trois boutons d'action sont disponibles :

- **Copier dans le presse-papiers** — Copie le texte dans votre presse-papiers
- **Télécharger en fichier** — Enregistre le texte en fichier `.txt`
- **Partager** — Ouvre le dialogue de partage natif (si disponible)

### Partager du texte depuis d'autres applications

Si QRShare est installée en tant que PWA, vous pouvez partager du texte depuis d'autres applications directement vers QRShare via le menu de partage du système. QRShare s'ouvrira en mode envoi avec le texte pré-rempli.

---

## Questions fréquentes

**L'application a-t-elle besoin d'internet ?**
Non pour les modes QR code, CIMBAR (transferts optiques) et audio (transfert par le son). Oui pour le mode WebRTC. Les outils Scanner et Créateur fonctionnent sans internet après le premier chargement.

**Quels navigateurs sont compatibles ?**
Tout navigateur moderne (Chrome, Firefox, Safari, Edge) sur ordinateur ou mobile.

**Mes fichiers passent-ils par un serveur ?**
Non. En mode QR, le transfert est purement optique. En mode WebRTC, le fichier va directement d'un appareil à l'autre.

**Puis-je installer l'application ?**
Oui. QRShare est une Progressive Web App (PWA) : votre navigateur peut vous proposer de l'installer sur votre écran d'accueil pour un accès hors-ligne.
