# amzinvite

Extension Chrome qui surveille les produits Amazon France en mode invitation et te prévient (via notification Chrome) quand un produit s'ouvre ou que tu es sélectionné — avec une fenêtre de 72h pour acheter.

## Pourquoi

Amazon ouvre régulièrement à la vente sur invitation des produits très demandés (Pokémon, GPU, consoles, etc.). Le système est opaque, les invitations partent vite, et tu n'as **que 72h** pour acheter une fois sélectionné. amzinvite t'évite de checker manuellement chaque produit plusieurs fois par jour.

## Features

- **Feed communautaire** : tracking automatique des produits actuellement en invitation, mis à jour par notre scraper
- **Notifications natives** : Chrome te prévient dès qu'un produit s'ouvre ou que tu es sélectionné
- **Auto-demander (opt-in)** : envoi automatique de la demande d'invitation dès qu'un produit s'ouvre, sans clic, sans fenêtre
- **Ajout manuel** : ajoute n'importe quelle URL `/dp/ASIN` à ton suivi perso
- **100% local** : ton historique et tes états restent sur ta machine
- **Dark mode**

## Installation

### Depuis le Chrome Web Store
*(lien à venir)*

### En mode développeur

1. Clone ce repo
2. `chrome://extensions`
3. Active "Mode développeur" (toggle haut-droite)
4. "Charger l'extension non empaquetée" → sélectionne le dossier `src/`

## Configuration

Aucune configuration n'est nécessaire pour démarrer. Les paramètres optionnels :

| Option | Défaut | Description |
|---|---|---|
| Intervalle de check | 30 min | À quelle fréquence l'extension vérifie l'état des produits |
| Auto-demander | OFF | Envoie automatiquement la demande d'invitation (voir warning ci-dessous) |
| Aider la communauté | OFF | Partage anonyme (UUID) des détections pour améliorer le feed |
| Contribuer au catalogue | OFF | Partage anonyme des produits Amazon que tu consultes |

## Auto-demander : warning

L'option **auto-demander** envoie un POST direct à l'endpoint d'invitation d'Amazon dès qu'un produit passe à "dispo". C'est rapide, discret, mais ça automatise une action sur ton compte Amazon — ce qui peut être contraire aux conditions d'utilisation d'Amazon. **Utilisation à tes risques.** OFF par défaut, opt-in explicite avec disclaimer.

## Privacy

- Aucune authentification, aucun compte
- Aucune donnée perso ne quitte ton navigateur par défaut
- Opt-in séparé pour partager des détections anonymes (UUID généré à l'installation)
- Possibilité de reset complet via le bouton "Reset" du popup

Voir [PRIVACY.md](./PRIVACY.md) pour le détail.

## Architecture

- `src/manifest.json` — MV3, host_permissions amazon.fr/com + data.amazon.fr, declarativeNetRequest
- `src/background.js` — service worker, alarmes, feed pull, détection HDP, auto-request POST direct
- `src/detector.js` — détecte l'état (available / already_requested / accepted / not_invitation) depuis le HTML Amazon
- `src/content.js` — content script sur les pages produit, affiche un badge + reporte l'état
- `src/popup.html` + `popup.js` — UI
- `src/onboarding.html` — page d'accueil au premier install
- `src/scrape-amazon-{listing,product}.js` — content scripts opt-in pour le catalogue communautaire

## Backend

L'extension consomme deux endpoints publics :

- `GET /api/public/invitations` — liste des produits actuellement en invitation (lecture seule, cacheable)
- `POST /api/extension/feedback` — remontée anonyme de détections (opt-in, UUID anonyme + HMAC)
- `POST /api/extension/observations` — partage anonyme des produits/prix observés (opt-in)

URLs configurées via les constantes en haut de `background.js`. À remplacer avant publication.

## Roadmap

- [ ] Publication Chrome Web Store
- [ ] Support amazon.com (.de, .co.uk, .it, .es)
- [ ] Notification Telegram en plus de Chrome notif
- [ ] Historique de prix par produit
- [ ] Export/import de la watchlist custom (JSON)
- [ ] Dashboard public des produits actuellement les plus actifs

## License

MIT — voir [LICENSE](./LICENSE).

## Disclaimer

Cette extension n'est **pas affiliée à Amazon**. C'est un outil personnel, distribué tel quel sans garantie. Toute utilisation de fonctionnalités d'automatisation est à tes propres risques et peut être contraire aux conditions d'utilisation d'Amazon.
