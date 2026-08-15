# Privacy Policy — amzinvite

**Dernière mise à jour :** 2026-08-15

amzinvite est conçu pour fonctionner avec un minimum de données.

## Données stockées localement

Les informations suivantes restent dans le navigateur :

- `instanceId` : identifiant anonyme généré localement
- un credential d'authentification aléatoire lié à l'instance anonyme
- `autoRequest`, `communityDataEnabled`, `trackPokemonTcgFr`, `notificationsEnabled`, `soundEnabled` : préférences de l'extension
- `customUrls` : liens Amazon ajoutés manuellement
- `knownStates` : états détectés pour les produits suivis
- `publicFeed`, `lastRun`, `lastFullRun`, `checkProgress`, `autoSpawnLog` : données internes de fonctionnement

Un reset complet est disponible depuis le popup.

## Données envoyées au service amzinvite

### Feed public

L'extension récupère la liste publique des produits en mode invitation.

### Partage anonyme

Quand l'option de partage anonyme est activée, l'extension peut envoyer :

- des changements d'état des invitations suivies
- un résumé technique du cycle (complet ou partiel, résultat, nombre de produits
  parcourus, erreurs, horaires, durée et version de l'extension)

Ces envois sont conçus pour améliorer la qualité du service. Ils n'incluent pas de nom, d'email ou d'informations de paiement.

## Suivi automatique

Par défaut, amzinvite suit automatiquement les produits POKÉMON TCG FR via le feed public. Tu peux :

1. désactiver ce suivi à tout moment
2. ajouter des liens Amazon FR manuellement (conservés même si le feed est désactivé)

Les contrôles sont planifiés après les vagues d'invitations et peuvent être
rattrapés au prochain démarrage de Chrome. Ils concernent uniquement les
produits suivis par le feed ou ajoutés manuellement.

## Notifications

Les notifications natives Chrome sont activées par défaut et peuvent être
désactivées dans les réglages. Leur désactivation n'efface pas les alertes :
elles restent disponibles dans l'historique local de l'extension. Le son est un
réglage distinct et peut également être désactivé.

## Données envoyées à Amazon

Si l'option **Auto-demander** est activée, l'extension peut envoyer la demande d'invitation directement à Amazon France ou Belgique en utilisant la session déjà ouverte dans le navigateur.

## Contrôle utilisateur

Tu peux à tout moment :

1. désactiver le partage anonyme
2. désactiver l'auto-demande
3. désactiver les notifications natives et le son
4. supprimer les données locales via le bouton Reset
5. désinstaller l'extension

Les liens vers PrixTCG, X et TikTok ne transmettent rien tant que tu ne choisis pas de
les ouvrir. Ils s'ouvrent alors dans un nouvel onglet selon les règles de
confidentialité du service concerné.

## Contact

Pour toute question liée à la confidentialité, utilise le dépôt GitHub officiel du projet.
