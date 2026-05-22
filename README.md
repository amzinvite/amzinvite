# amzinvite

Extension Chrome qui surveille les produits Amazon en mode invitation et te prévient quand un produit s'ouvre ou quand tu es sélectionné.

## Ce que fait l'extension

- suit automatiquement les produits actuellement en mode invitation
- notifie quand une invitation devient disponible ou acceptée
- permet d'ajouter un lien Amazon manuellement à ton suivi local
- propose une option d'auto-demande, désactivée par défaut
- permet de désactiver à tout moment le partage anonyme utilisé pour améliorer le service

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
| Intervalle auto | 30 min | Fréquence de vérification |
| Partage anonyme | ON | Aide à améliorer le feed et le catalogue |
| Auto-demander | OFF | Envoie la demande d'invitation automatiquement |

## Confidentialité

- aucun compte requis
- données locales conservées dans le navigateur
- partage anonyme désactivable à tout moment
- reset complet possible depuis le popup

Voir [PRIVACY.md](./PRIVACY.md).

## Structure

- `src/background.js` : logique principale de l'extension
- `src/popup.html` et `src/popup.js` : interface du popup
- `src/onboarding.html` : écran de bienvenue
- `src/content.js` : détection d'état sur les pages produit
- `src/detector.js` : détection de l'état invitation

## Avertissement

amzinvite n'est pas affilié à Amazon. L'option d'auto-demande peut être contraire aux conditions d'utilisation d'Amazon. Utilisation à tes risques.

## Licence

MIT
