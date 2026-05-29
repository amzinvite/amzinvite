# amzinvite

Extension Chrome qui surveille les produits Amazon en mode invitation et te prévient quand un produit s'ouvre ou quand tu es sélectionné.

## Ce que fait l'extension

- ne suit rien automatiquement par défaut
- peut suivre automatiquement les produits POKÉMON TCG FR via une option dédiée
- notifie quand une invitation devient disponible ou acceptée
- permet d'ajouter un lien Amazon manuellement à ton suivi local
- propose une option d'auto-demande, désactivée par défaut
- permet de désactiver à tout moment le partage anonyme utilisé pour améliorer le service
- affiche les miniatures produits extraites depuis Amazon
- indique si tu es connecté à ton compte Amazon
- scan individuel par produit depuis le popup

## Installation

### Depuis le Chrome Web Store
Lien à venir.

### En mode développeur

1. Clone le dépôt
2. Ouvre `chrome://extensions`
3. Active le mode développeur
4. Clique sur "Charger l'extension non empaquetée"
5. Sélectionne le dossier `src/`

## Réglages principaux

| Option | Défaut | Description |
|---|---|---|
| Intervalle auto | 30 min | Fréquence de vérification automatique |
| Partage anonyme | ON | Aide à améliorer le feed et le catalogue |
| Suivi POKÉMON TCG FR | OFF | Active le suivi automatique du feed public |
| Auto-demander | OFF | Envoie la demande d'invitation automatiquement |

## Suivi et interface

- sans option activée, l'extension ne suit rien automatiquement
- tu peux ajouter un produit manuellement via son lien Amazon en mode invitation
- tu peux activer le suivi automatique de POKÉMON TCG FR depuis les réglages
- l'item en cours de vérification remonte en tête de liste avec une barre de progression, un compte à rebours et un ETA global
- un bouton de scan individuel permet de relancer un check unitaire sur n'importe quel produit
- les miniatures sont extraites automatiquement lors des checks et mises en cache localement

## Confidentialité

- aucun compte requis
- données locales conservées dans le navigateur
- partage anonyme désactivable à tout moment
- reset complet possible depuis le popup

Voir [PRIVACY.md](./PRIVACY.md).

## Structure

- `src/background.js` : logique principale (checks, watchlist, feed, notifications)
- `src/popup.html` et `src/popup.js` : interface du popup
- `src/onboarding.html` : écran de bienvenue
- `src/content.js` : détection d'état sur les pages produit Amazon
- `src/detector.js` : logique de détection des états invitation
- `src/amazon-dom.js` : extraction des données produit depuis le DOM Amazon
- `src/scrape-amazon-product.js` : scraping des pages produit
- `src/scrape-amazon-listing.js` : scraping des pages listing

## Avertissement

amzinvite n'est pas affilié à Amazon. L'option d'auto-demande peut être contraire aux conditions d'utilisation d'Amazon. Utilisation à tes risques.

## Licence

MIT
