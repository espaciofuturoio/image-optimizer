import './App.css'
import { SimpleImageUploader } from './components/simple_image_uploader'

function App() {
  return (
    <>
      <SimpleImageUploader />
      <footer className="mt-12 mb-6 text-center text-sm text-gray-500">
        <div className="max-w-lg mx-auto px-4">
          <h3 className="font-medium text-base mb-2">About TinyImage</h3>
          <p className="mb-3">
            A powerful image optimization tool that reduces file size while preserving quality. No signup required.
          </p>
          <p className="text-xs">
            Created by <a href="https://rubenabix.com" className="text-blue-500 hover:underline">Ruben Abarca</a> • {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </>
  )
}

export default App
