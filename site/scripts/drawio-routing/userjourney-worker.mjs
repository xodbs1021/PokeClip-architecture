import { generateUserJourneyRouting } from './userjourney-generator.mjs'

let sourceXml = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { sourceXml += chunk })
process.stdin.on('end', () => {
  try {
    process.stdout.write(JSON.stringify(generateUserJourneyRouting(sourceXml)))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
})
